# ChatGPT-to-API Rust Migration Design

**Date**: 2026-07-16  
**Status**: Design Approved  
**Target**: Personal use (1-3 concurrent users)

---

## Executive Summary

Migrate the existing Node.js ChatGPT-to-API proxy to Rust with enhanced tool execution capabilities inspired by the Chimera project. The system will remain a simple, personal-use proxy optimized for low resource usage and ease of maintenance.

**What we're building:**
- ✅ Rust-based ChatGPT web proxy (session token authentication)
- ✅ Chimera-inspired tool execution system (filesystem, HTTP, shell, code analysis)
- ✅ Improved tool calling with structured schemas
- ✅ TypeScript dashboard integration (served as static files)
- ❌ No databases (in-memory state only)
- ❌ No multi-LLM routing (ChatGPT only)
- ❌ No production features (metrics, rate limiting, API docs)

**Timeline estimate:** 3-4 weeks

---

## Architecture Overview

### High-Level Structure

```
┌─────────────────────────────────────────┐
│  Client (Cursor/Continue/LobeChat)     │
└───────────────────┬─────────────────────┘
                    │ HTTPS
                    ▼
┌─────────────────────────────────────────┐
│  Axum HTTP Server                       │
│  - CORS Middleware                      │
│  - Static Dashboard (/dashboard/dist)   │
│  - API Routes (/v1/*)                   │
└───────────────────┬─────────────────────┘
                    │
        ┌───────────┼───���───────┐
        │           │           │
        ▼           ▼           ▼
┌──────────┐  ┌──────────┐  ┌──────────┐
│   Auth   │  │   Conv   │  │   Tool   │
│  Manager │  │  Cache   │  │ Executor │
└──────────┘  └──────────┘  └──────────┘
        │           │           │
        └───────────┼───────────┘
                    ▼
┌─────────────────────────────────────────┐
│  ChatGPT Backend Client                 │
│  - Session authentication               │
│  - PoW solver (SHA3-512)                │
│  - SSE stream transformer               │
└─────────────────────────────────────────┘
```

### Component Layers

1. **HTTP Layer** - Axum server with CORS, static file serving
2. **State Management** - In-memory caches (token, conversations)
3. **ChatGPT Integration** - Session auth, PoW solving, API client
4. **Tool System** - Filesystem, HTTP, shell, code analysis tools
5. **Streaming** - SSE transformation (ChatGPT → OpenAI format)

---

## Project Structure

```
chatgpt-to-api-rust/
├── Cargo.toml
├── .env
├── .env.example
├── README.md
├── src/
│   ├── main.rs               # Server entry point
│   ├── config.rs             # Environment config
│   ├── error.rs              # Error types
│   ├── routes/
│   │   ├── mod.rs
│   │   ├── chat.rs           # /v1/chat/completions
│   │   └── models.rs         # /v1/models
│   ├── auth/
│   │   ├── mod.rs
│   │   ├── token_manager.rs  # Token refresh logic
│   │   └── session.rs        # Session cookie handling
│   ├── chatgpt/
│   │   ├── mod.rs
│   │   ├── client.rs         # HTTP client for backend-api
│   │   ├── pow.rs            # Sentinel PoW solver
│   │   └── models.rs         # ChatGPT API types
│   ├── conversation/
│   │   ├── mod.rs
│   │   ├── cache.rs          # Thread-safe cache
│   │   └── hash.rs           # Message fingerprinting
│   ├── tools/
│   │   ├── mod.rs
│   │   ├── executor.rs       # Tool execution engine
│   │   ├── parser.rs         # Tool call extraction
│   │   ├── filesystem.rs     # Filesystem tool
│   │   ├── http.rs           # HTTP request tool
│   │   ├── shell.rs          # Shell command tool
│   │   └── code.rs           # Code analysis tool
│   └── streaming/
│       ├── mod.rs
│       └── transformer.rs    # ChatGPT → OpenAI format
├── dashboard/                # Existing TypeScript dashboard
│   ├── package.json
│   ├── src/
│   └── dist/                 # Built static files
└── tests/
    ├── integration/
    └── unit/
```

---

## Core Dependencies

```toml
[dependencies]
axum = "0.7"
tokio = { version = "1", features = ["full"] }
reqwest = { version = "0.11", features = ["json", "stream"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
sha3 = "0.10"           # PoW solver
sha2 = "0.10"           # Message hashing
tower-http = { version = "0.5", features = ["cors", "fs"] }
tracing = "0.1"
tracing-subscriber = "0.3"
dotenv = "0.15"
```

---

## State Management

### Application State

```rust
pub struct AppState {
    // Token cache: None = not fetched, Some(token, expiry)
    auth_token: Arc<RwLock<Option<(String, Instant)>>>,
    
    // Simple HashMap - no LRU needed for personal use
    conversations: Arc<RwLock<HashMap<String, ConversationContext>>>,
    
    // HTTP client pool (reusable connections)
    http_client: reqwest::Client,
    
    // Tool executor
    tools: Arc<ToolExecutor>,
    
    // Configuration
    config: Arc<Config>,
}

struct ConversationContext {
    conversation_id: String,
    parent_message_id: String,
    original_tool_calls: HashMap<String, ToolCall>,
}
```

### Concurrency Strategy

- `Arc<RwLock<T>>` for shared mutable state
- `RwLock` allows multiple readers, single writer
- No background tasks (reactive token refresh only)
- `reqwest::Client` is Clone-cheap and connection-pooled

---

## Authentication & Token Management

### Token Lifecycle

1. **Initial fetch:** First request triggers token fetch using `CHATGPT_SESSION_TOKEN`
2. **Cache:** Store `(access_token, expires_at)` in `Arc<RwLock<Option<...>>>`
3. **Usage:** Clone token for each request
4. **Refresh on 401:** If ChatGPT returns 401, acquire write lock, re-fetch, retry once
5. **Expiry check:** Before using cached token, check `Instant::now() < expires_at`

### Token Refresh Strategy

**Reactive-only approach:**
- No background task (no 30-minute polling)
- On 401 response: immediately refresh and retry request once
- Check token expiry before each request
- Exponential backoff on refresh failures (3 retries max)

### Session Token Handling

```rust
// Read from environment
CHATGPT_SESSION_TOKEN=eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIn0...

// Send as cookie
Cookie: __Secure-next-auth.session-token=<token>

// Optional: full cookie header for complex auth
CHATGPT_COOKIES=<full-cookie-string>
```

---

## Conversation State Management

### Message Fingerprinting (SHA-256)

```rust
fn hash_messages(messages: &[Message]) -> String {
    let clean_messages: Vec<CleanMessage> = messages
        .iter()
        .map(|m| CleanMessage {
            role: m.role.clone(),
            content: extract_text_content(&m.content),
            name: m.name.clone(),
            tool_calls: m.tool_calls.clone(),
            tool_call_id: m.tool_call_id.clone(),
        })
        .collect();
    
    let json = serde_json::to_string(&clean_messages).unwrap();
    let hash = sha2::Sha256::digest(json.as_bytes());
    format!("{:x}", hash)
}
```

### Stateful vs Stateless Mode

**Stateful (default):**
- No client tools → hash messages, look up cached conversation
- Continue existing thread with conversation_id + parent_message_id
- Server tools (`browser`, `python`, `dalle`, `myfiles_browser`) use this mode

**Stateless (tool calling):**
- Client tools present → bypass cache, start new conversation
- Inject tool call prompt preamble
- Optionally upgrade to thinking model

### Cache Operations

- **Lookup:** Hash incoming messages, check cache for conversation context
- **Store:** After response, store new (conversation_id, parent_message_id)
- **Eviction:** None needed for personal use (won't hit limits)

---

## Sentinel Proof-of-Work Solver

### Challenge Structure

ChatGPT's Sentinel PoW requires finding a `seed` where:
```
SHA3-512(seed + required_prefix) starts with difficulty bits of zeros
```

### Implementation

```rust
use sha3::{Sha3_512, Digest};

fn solve_pow(required: &str, difficulty: &str) -> Option<String> {
    let target_prefix = difficulty.parse::<usize>().ok()?;
    
    // Brute force: try seeds until hash matches
    for attempt in 0..1_000_000 {
        let seed = format!("seed_{}", attempt);
        let input = format!("{}{}", seed, required);
        
        // Fresh hasher per iteration
        let mut hasher = Sha3_512::new();
        hasher.update(input.as_bytes());
        let hash = hasher.finalize();
        
        if count_leading_zero_bits(&hash) >= target_prefix {
            return Some(seed);
        }
    }
    
    None // Failed after 1M attempts
}

fn count_leading_zero_bits(hash: &[u8]) -> usize {
    let mut count = 0;
    for byte in hash {
        if *byte == 0 {
            count += 8;
        } else {
            count += byte.leading_zeros() as usize;
            break;
        }
    }
    count
}
```

### Performance

- Rust should match or beat Node.js "0-5ms" claim
- Timeout after 5 seconds to avoid blocking requests
- Optional: parallel solving with `rayon` for high difficulty

---

## Tool System Architecture

### Chimera-Inspired Tool Calling

**Structured tool definitions:**

```rust
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value, // JSON Schema
}
```

**System prompt injection:**

```rust
const TOOL_PROMPT_TEMPLATE: &str = r#"
You have access to these tools:
{tool_schemas}

When you need to call a tool, respond with:
TOOL_CALL_START
{"tool_calls": [{"name": "tool_name", "arguments": {...}}]}
TOOL_CALL_END

You can output reasoning or explanation before TOOL_CALL_START.
"#;
```

**Single parser with validation:**

```rust
pub fn parse_tool_calls(
    text: &str,
    schemas: &[ToolDefinition]
) -> Result<Vec<ToolCall>, ParseError> {
    // Extract JSON between delimiters
    let json_str = extract_between_markers(
        text,
        "TOOL_CALL_START",
        "TOOL_CALL_END"
    )?;
    
    // Parse JSON
    let wrapper: ToolCallsWrapper = serde_json::from_str(&json_str)?;
    
    // Validate against schemas
    for call in &wrapper.tool_calls {
        validate_tool_call(call, schemas)?;
    }
    
    Ok(wrapper.tool_calls)
}
```

### Available Tools

**1. FilesystemTool**
- Operations: read, write, list, delete, mkdir, exists
- Security: path validation, allowed directories, size limits

**2. HTTPRequestTool**
- Methods: GET, POST, PUT, DELETE, PATCH
- Security: block localhost/private IPs, domain whitelist, size limits

**3. ShellTool**
- Execute shell commands
- Security: command whitelist, timeout, output size limits

**4. CodeAnalysisTool**
- Parse, lint, analyze code
- Security: read-only operations

### Security Constraints

```rust
pub struct SecurityConfig {
    // Filesystem
    allowed_directories: Vec<PathBuf>,
    max_file_size: usize, // 10MB default
    
    // HTTP
    blocked_hosts: HashSet<String>, // localhost, 127.0.0.1, etc.
    allowed_domains: Option<HashSet<String>>,
    max_response_size: usize, // 10MB default
    request_timeout: Duration, // 30s default
    
    // Shell
    allowed_commands: HashSet<String>, // whitelist
    command_timeout: Duration, // 30s default
    max_output_size: usize, // 1MB default
}
```

### Tool Executor

```rust
pub struct ToolExecutor {
    filesystem_tool: FilesystemTool,
    http_tool: HTTPRequestTool,
    shell_tool: ShellTool,
    code_tool: CodeAnalysisTool,
    config: ToolConfig,
}

impl ToolExecutor {
    pub async fn execute(
        &self,
        tool_call: &ToolCall,
    ) -> Result<ToolResult, ToolError> {
        match tool_call.name.as_str() {
            "filesystem" => self.filesystem_tool.execute(tool_call).await,
            "http_request" => self.http_tool.execute(tool_call).await,
            "shell" => self.shell_tool.execute(tool_call).await,
            "code_analysis" => self.code_tool.execute(tool_call).await,
            _ => Err(ToolError::UnknownTool(tool_call.name.clone())),
        }
    }
}
```

---

## SSE Streaming & Response Transformation

### ChatGPT to OpenAI Format

ChatGPT sends accumulated chunks; OpenAI sends delta chunks.

```rust
pub async fn transform_stream(
    chatgpt_stream: impl Stream<Item = ChatGPTChunk>,
    request_id: String,
) -> impl Stream<Item = OpenAIChunk> {
    let mut previous_content = String::new();
    
    chatgpt_stream.map(move |chunk| {
        // Extract delta (new content since last chunk)
        let current = chunk.message.content.text;
        let delta = current.strip_prefix(&previous_content)
            .unwrap_or(&current)
            .to_string();
        
        previous_content = current;
        
        // Convert to OpenAI format
        OpenAIChunk {
            id: format!("chatcmpl-{}", request_id),
            object: "chat.completion.chunk",
            created: chunk.created,
            model: chunk.model,
            choices: vec![Choice {
                index: 0,
                delta: Delta {
                    role: Some("assistant"),
                    content: Some(delta),
                    tool_calls: transform_tool_calls(&chunk),
                },
                finish_reason: chunk.finish_reason,
            }],
        }
    })
}
```

### Thinking Models Support

```rust
// Thinking models (o1, o3, gpt-5-5-thinking) output reasoning_content separately
struct ThinkingResponse {
    reasoning_content: Option<String>,
    content: String,
    tool_calls: Option<Vec<ToolCall>>,
}

// Stream both reasoning and content
// OpenAI format: separate "reasoning" field in delta
```

### SSE Format

```rust
async fn send_sse_chunk(chunk: OpenAIChunk) -> Result<Bytes> {
    let json = serde_json::to_string(&chunk)?;
    Ok(Bytes::from(format!("data: {}\n\n", json)))
}

// Final chunk: data: [DONE]
```

---

## Request/Response Flow

### Complete Request Lifecycle

```rust
async fn handle_chat_completion(
    state: Arc<AppState>,
    request: ChatCompletionRequest,
) -> Result<Response> {
    // 1. Check/refresh auth token
    let token = get_or_refresh_token(&state).await?;
    
    // 2. Determine mode (stateful vs stateless)
    let has_client_tools = request.tools.is_some();
    let mode = if has_client_tools {
        Mode::Stateless
    } else {
        Mode::Stateful
    };
    
    // 3. Build ChatGPT request
    let chatgpt_req = match mode {
        Mode::Stateful => {
            // Hash messages, lookup conversation cache
            let hash = hash_messages(&request.messages);
            let ctx = state.conversations.read().await.get(&hash).cloned();
            
            build_stateful_request(request, ctx)
        }
        Mode::Stateless => {
            // Inject tool prompt, upgrade to thinking model if needed
            build_stateless_request(request, &state.config)
        }
    };
    
    // 4. Solve PoW if required
    if let Some(pow_challenge) = chatgpt_req.sentinel {
        let solution = solve_pow(&pow_challenge.required, &pow_challenge.difficulty)?;
        chatgpt_req.proof_token = Some(solution);
    }
    
    // 5. Send to ChatGPT backend
    let response = state.http_client
        .post("https://chatgpt.com/backend-api/conversation")
        .bearer_auth(&token)
        .json(&chatgpt_req)
        .send()
        .await?;
    
    // 6. Handle 401 (retry with token refresh)
    if response.status() == 401 {
        let new_token = refresh_token_now(&state).await?;
        return retry_with_token(chatgpt_req, new_token).await;
    }
    
    // 7. Transform stream
    if request.stream {
        let stream = transform_chatgpt_stream(response.bytes_stream());
        return Ok(stream_sse_response(stream));
    }
    
    // 8. Parse response for tool calls
    let chatgpt_resp: ChatGPTResponse = response.json().await?;
    let tool_calls = parse_tool_calls(&chatgpt_resp.message.content.text, &request.tools)?;
    
    // 9. Execute tools if present
    if !tool_calls.is_empty() {
        let results = execute_tools(&state.tools, &tool_calls).await?;
        
        // Continue conversation with tool results
        let mut new_messages = request.messages.clone();
        new_messages.push(assistant_message_with_tools(tool_calls));
        new_messages.extend(tool_result_messages(results));
        
        // Recursive call with tool results
        return handle_chat_completion(
            state,
            ChatCompletionRequest { messages: new_messages, ..request }
        ).await;
    }
    
    // 10. Cache conversation state
    if mode == Mode::Stateful {
        cache_conversation_mapping(
            &state,
            hash_messages(&request.messages),
            &chatgpt_resp.conversation_id,
            &chatgpt_resp.message.id,
        ).await;
    }
    
    // 11. Return OpenAI-formatted response
    Ok(Json(to_openai_response(chatgpt_resp)))
}
```

### Error Handling

- **Network errors:** Exponential backoff, 3 retries max
- **401 errors:** Immediate token refresh + single retry
- **429 errors:** Return to client with retry-after header
- **Tool errors:** Return as tool error message, continue conversation
- **Parse errors:** Return 500 with clear error message

---

## Configuration & Environment

### Environment Variables

```rust
pub struct Config {
    // Server
    pub host: String,              // default: 0.0.0.0
    pub port: u16,                 // default: 3000
    
    // ChatGPT Authentication
    pub session_token: String,     // required
    pub cookies: Option<String>,   // optional
    
    // API Security
    pub api_key: Option<String>,   // optional
    
    // Model Configuration
    pub default_model: String,     // default: "auto"
    pub tool_force_thinking: bool, // default: false
    
    // Tool Security
    pub tool_allowed_directories: Vec<PathBuf>,
    pub tool_allowed_commands: Vec<String>,
    pub tool_allowed_domains: Option<Vec<String>>,
    
    // Performance
    pub request_timeout: Duration, // default: 60s
}
```

### .env Example

```env
# Server
PORT=3000
HOST=0.0.0.0

# ChatGPT Auth (required)
CHATGPT_SESSION_TOKEN=eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIn0...

# Optional: Full cookie header
CHATGPT_COOKIES=

# Optional: Protect your proxy
PROXY_API_KEY=your-secret-key

# Model defaults
DEFAULT_MODEL=auto
TOOL_FORCE_THINKING=false

# Tool Security
TOOL_ALLOWED_DIRECTORIES=/tmp,/home/user/workspace
TOOL_ALLOWED_COMMANDS=ls,cat,grep,git
TOOL_ALLOWED_DOMAINS=api.github.com,api.example.com
```

---

## Dashboard Integration

### Serving Static Files

```rust
use tower_http::services::ServeDir;

let app = Router::new()
    // API routes
    .route("/v1/chat/completions", post(chat_completions))
    .route("/v1/models", get(list_models))
    
    // Serve dashboard static files
    .nest_service("/", ServeDir::new("dashboard/dist"))
    
    // State & middleware
    .with_state(app_state)
    .layer(CorsLayer::permissive())
    .layer(TraceLayer::new_for_http());
```

### Dashboard Build

```bash
# Build TypeScript dashboard
cd dashboard
npm install
npm run build  # outputs to dashboard/dist

# Rust serves dashboard/dist at root
```

**Dashboard remains unchanged:**
- TypeScript/React (existing implementation)
- Same features (prompting, model switching, metrics)
- Communicates with Rust backend via `/v1/*` API

---

## Personal-Use Optimizations

### Removed for Simplicity

❌ Swagger/OpenAPI docs  
❌ Rate limiting middleware  
❌ Metrics/observability (simple logging only)  
❌ Health check endpoints  
❌ Request ID generation  
❌ LRU cache (simple HashMap sufficient)  
❌ Complex authentication middleware

### Compile-Time Optimizations

```toml
[profile.release]
opt-level = 3           # Maximum optimizations
lto = "fat"             # Link-time optimization
codegen-units = 1       # Better optimization
strip = true            # Strip symbols (smaller binary)
panic = "abort"         # Smaller binary, faster panics
```

### Resource Usage

- **Binary size:** ~5-10MB (vs 15-20MB production-ready)
- **Memory footprint:** ~30-50MB (vs 80-100MB with full features)
- **Startup time:** < 100ms
- **Build time:** ~1-2 minutes (release build)

---

## Error Handling & Logging

### Error Types

```rust
#[derive(Debug)]
pub enum AppError {
    // Auth errors
    TokenRefreshFailed(String),
    InvalidSessionToken,
    
    // ChatGPT API errors
    ChatGPTError { status: u16, message: String },
    PowSolveFailed,
    
    // Tool errors
    ToolExecutionFailed { tool: String, reason: String },
    ToolNotFound(String),
    
    // Parse errors
    InvalidToolCall(String),
    StreamParseError(String),
    
    // Network errors
    NetworkError(reqwest::Error),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            AppError::InvalidSessionToken => 
                (StatusCode::UNAUTHORIZED, "Invalid session token"),
            AppError::ChatGPTError { status, message } => 
                (StatusCode::from_u16(status).unwrap(), message.as_str()),
            AppError::ToolNotFound(name) => 
                (StatusCode::BAD_REQUEST, format!("Tool not found: {}", name)),
            _ => (StatusCode::INTERNAL_SERVER_ERROR, "Internal error"),
        };
        
        (status, Json(json!({ "error": message }))).into_response()
    }
}
```

### Logging

```rust
// Setup in main.rs
tracing_subscriber::fmt()
    .with_target(false)
    .with_thread_ids(false)
    .with_level(true)
    .init();

// Throughout code
tracing::info!("Token refreshed successfully");
tracing::warn!("PoW solve took longer than expected: {:?}", duration);
tracing::error!("Failed to parse tool call: {}", err);
```

**Simple stdout logging - no complex observability.**

---

## Build & Deployment

### Development

```bash
# Clone and setup
git clone <repo>
cd chatgpt-to-api-rust
cp .env.example .env
# Edit .env with your CHATGPT_SESSION_TOKEN

# Build dashboard
cd dashboard
npm install
npm run build
cd ..

# Run development server
cargo run
```

### Production Build

```bash
# Optimized release build
cargo build --release

# Binary location
./target/release/chatgpt-to-api-rust
```

### Docker (Optional)

```dockerfile
# Multi-stage build
FROM node:18 AS dashboard-builder
WORKDIR /app/dashboard
COPY dashboard/package*.json ./
RUN npm install
COPY dashboard/ ./
RUN npm run build

FROM rust:1.75 AS rust-builder
WORKDIR /app
COPY Cargo.* ./
COPY src/ ./src/
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=rust-builder /app/target/release/chatgpt-to-api-rust ./
COPY --from=dashboard-builder /app/dashboard/dist ./dashboard/dist
EXPOSE 3000
CMD ["./chatgpt-to-api-rust"]
```

### Render Deployment

```yaml
# render.yaml
services:
  - type: web
    name: chatgpt-proxy-rust
    env: docker
    plan: starter
    dockerfilePath: ./Dockerfile
    envVars:
      - key: CHATGPT_SESSION_TOKEN
        sync: false
      - key: PORT
        value: 3000
```

### Simple Personal Deployment

```bash
# No Docker needed - just run the binary
./chatgpt-to-api-rust

# Or use systemd service
sudo systemctl enable chatgpt-proxy
sudo systemctl start chatgpt-proxy

# Or run in tmux/screen
tmux new -s proxy
./chatgpt-to-api-rust
```

---

## Testing Strategy

### Unit Tests

- Message hashing/fingerprinting
- PoW solver correctness
- Tool call parsing
- Stream transformation
- Error handling

### Integration Tests

- Full request/response cycle
- Token refresh flow
- Conversation state management
- Tool execution
- SSE streaming

### Manual Testing

- Connect Cursor/Continue IDE
- Test various tool calls
- Verify thinking model support
- Test dashboard UI

**No complex CI/CD for personal use - manual testing is sufficient.**

---

## Migration Strategy

### Phase 1: Core Proxy (Week 1-2)

1. Setup Rust project structure
2. Implement auth & token management
3. Implement PoW solver
4. Implement conversation cache
5. Basic ChatGPT API client
6. SSE streaming

**Milestone:** Can proxy basic chat requests

### Phase 2: Tool System (Week 2-3)

1. Tool definition system
2. Tool call parser
3. Filesystem tool
4. HTTP tool
5. Shell tool
6. Code analysis tool

**Milestone:** Tools working end-to-end

### Phase 3: Polish (Week 3-4)

1. Dashboard integration
2. Error handling improvements
3. Testing & bug fixes
4. Documentation
5. Deployment setup

**Milestone:** Production-ready for personal use

---

## Known Issues to Fix

From the original Node.js version:

1. **Token refresh expiration** - Fixed with reactive refresh on 401
2. **Chain of thought not working** - Fixed with thinking model support
3. **Tool calling unreliable** - Fixed with structured schemas and single parser
4. **No automatic token refresh** - Fixed with expiry checks

---

## Future Enhancements (Optional)

Things that could be added later if needed:

- **Vector/Graph databases** - If cross-conversation search becomes important
- **Multi-LLM routing** - If you want to route to other providers
- **Metrics dashboard** - If you want observability
- **Rate limiting** - If you open it to more users
- **API key auth** - If you want to share with team

**For now: Keep it simple. Add features only when you actually need them.**

---

## Success Criteria

✅ Successfully proxies ChatGPT web to OpenAI API format  
✅ Token refresh works automatically on 401  
✅ Thinking models (o1, o3, gpt-5-5-thinking) work correctly  
✅ Tool calling is reliable with structured schemas  
✅ Tools (filesystem, HTTP, shell, code) execute successfully  
✅ Streaming responses work in Cursor/Continue  
✅ Dashboard serves correctly  
✅ Memory usage < 100MB under normal use  
✅ Binary size < 15MB  
✅ Startup time < 100ms  

---

## Conclusion

This design provides a clean, efficient Rust implementation of the ChatGPT proxy with enhanced tool execution capabilities. By focusing on personal use and removing production complexity, we keep the codebase maintainable and the resource usage minimal.

The Chimera-inspired tool system provides a robust, schema-driven approach to tool calling that fixes the reliability issues in the current Node.js version.

**Next steps:**
1. Review and approve this design
2. Create implementation plan
3. Begin Phase 1 development

# Architecture Documentation

**Project**: ChatGPT-to-API Rust Proxy  
**Version**: 1.0  
**Last Updated**: 2026-07-16  
**Status**: Design Phase

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Architecture Layers](#architecture-layers)
3. [Component Design](#component-design)
4. [Data Flow](#data-flow)
5. [State Management](#state-management)
6. [Security Architecture](#security-architecture)
7. [Performance Considerations](#performance-considerations)
8. [Deployment Architecture](#deployment-architecture)

---

## System Overview

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    External Clients                          │
│  (Cursor, Continue, Kilo Code, LobeChat, Custom Scripts)   │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTPS / HTTP
                         │ OpenAI-compatible API
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                   Axum HTTP Server                           │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Middleware Layer                                     │  │
│  │  - CORS (permissive for local dev)                   │  │
│  │  - Tracing (structured logging)                      │  │
│  │  - Optional API key auth                             │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Route Layer                                          │  │
│  │  - POST /v1/chat/completions                         │  │
│  │  - GET  /v1/models                                   │  │
│  │  - GET  /* (static dashboard files)                  │  │
│  └───────────────────────────────────────────────────────┘  │
└────────────────────────┬────────────────────────────────────┘
                         │
        ┌────────────────┼────────────────┐
        │                │                │
        ▼                ▼                ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│    Auth      │  │ Conversation │  │     Tool     │
│   Manager    │  │    Cache     │  │   Executor   │
│              │  │              │  │              │
│ - Token      │  │ - Message    │  │ - Filesystem │
│   refresh    │  │   hashing    │  │ - HTTP       │
│ - Session    │  │ - Thread     │  │ - Shell      │
│   cookies    │  │   mapping    │  │ - Code       │
└──────────────┘  └──────────────┘  └──────────────┘
        │                │                │
        └────────────────┼────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              ChatGPT Backend Integration                     │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  HTTP Client (reqwest)                                │  │
│  │  - Connection pooling                                 │  │
│  │  - Bearer token authentication                        │  │
│  │  - Retry logic (401 → token refresh)                 │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  PoW Solver                                           │  │
│  │  - SHA3-512 brute force                              │  │
│  │  - Configurable timeout                              │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Stream Transformer                                   │  │
│  │  - ChatGPT accumulated → OpenAI delta                │  │
│  │  - SSE format encoding                               │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────┬───────────────────────────────────┘
                          │ HTTPS
                          ▼
┌─────────────────────────────────────────────────────────────┐
│              ChatGPT Web Backend                             │
│  https://chatgpt.com/backend-api/conversation               │
│  https://chatgpt.com/api/auth/session                       │
└─────────────────────────────────────────────────────────────┘
```

### System Characteristics

- **Stateless HTTP Layer:** Each request is independent (except for cached state)
- **In-Memory State:** Token cache, conversation cache (no database)
- **Synchronous Request Flow:** Sequential processing with async I/O
- **Single Binary:** All components compiled into one executable

---

## Architecture Layers

### Layer 1: HTTP Interface

**Responsibility:** Accept requests, route to handlers, return responses

**Components:**
- Axum router
- CORS middleware
- Tracing middleware
- Static file server (dashboard)

**Technology:**
- `axum` - Web framework
- `tower-http` - HTTP middleware utilities

**Design Decisions:**
- Simple routing (no complex pattern matching)
- Permissive CORS for local development
- Static dashboard served via `ServeDir`

---

### Layer 2: Business Logic

**Responsibility:** Implement proxy logic, tool execution, state management

**Components:**
- Auth manager (token lifecycle)
- Conversation cache (thread mapping)
- Tool executor (filesystem, HTTP, shell, code)
- Request/response transformers

**Technology:**
- Pure Rust (no framework dependencies in this layer)
- `Arc<RwLock<T>>` for shared state
- `serde` for serialization

**Design Decisions:**
- Reactive token refresh (no background tasks)
- Simple HashMap cache (no LRU for personal use)
- Whitelisted tool execution (security first)

---

### Layer 3: External Integration

**Responsibility:** Communicate with ChatGPT backend

**Components:**
- HTTP client (reqwest)
- PoW solver (SHA3-512)
- SSE stream parser/transformer

**Technology:**
- `reqwest` - HTTP client with connection pooling
- `sha3` - PoW hashing
- `tokio-stream` - Stream utilities

**Design Decisions:**
- Connection pooling for efficiency
- Exponential backoff on failures
- Single retry on 401 (token refresh)

---

## Component Design

### 1. Auth Manager

```rust
pub struct AuthManager {
    token: Arc<RwLock<Option<(String, Instant)>>>,
    session_token: String,
    cookies: Option<String>,
    client: reqwest::Client,
}

impl AuthManager {
    pub async fn get_token(&self) -> Result<String>;
    pub async fn refresh_token(&self) -> Result<String>;
    fn is_token_expired(&self, expires_at: Instant) -> bool;
}
```

**Responsibilities:**
- Fetch initial access token from session token
- Check token expiry before use
- Refresh token on 401 responses
- Store token + expiry in Arc<RwLock>

**State:**
- `Option<(token, expiry)>` - None = not fetched, Some = cached

**Thread Safety:**
- RwLock allows multiple readers (fast path)
- Single writer during refresh (slow path)

---

### 2. Conversation Cache

```rust
pub struct ConversationCache {
    cache: Arc<RwLock<HashMap<String, ConversationContext>>>,
}

pub struct ConversationContext {
    conversation_id: String,
    parent_message_id: String,
    original_tool_calls: HashMap<String, ToolCall>,
}

impl ConversationCache {
    pub async fn lookup(&self, hash: &str) -> Option<ConversationContext>;
    pub async fn store(&self, hash: String, ctx: ConversationContext);
    pub fn hash_messages(messages: &[Message]) -> String;
}
```

**Responsibilities:**
- Hash message histories (SHA-256)
- Cache conversation thread mappings
- Provide O(1) lookup by hash

**State:**
- `HashMap<String, ConversationContext>` - Simple hash map (no LRU needed)

**Cache Policy:**
- No eviction (won't hit limits with personal use)
- Cleared on server restart

---

### 3. Tool Executor

```rust
pub struct ToolExecutor {
    filesystem: FilesystemTool,
    http: HTTPRequestTool,
    shell: ShellTool,
    code: CodeAnalysisTool,
    config: SecurityConfig,
}

impl ToolExecutor {
    pub async fn execute(&self, call: &ToolCall) -> Result<ToolResult>;
    fn validate_tool_call(&self, call: &ToolCall, schema: &ToolDefinition) -> Result<()>;
}
```

**Responsibilities:**
- Route tool calls to appropriate tool
- Validate arguments against schemas
- Enforce security constraints
- Return structured results

**Tool Interface:**
```rust
#[async_trait]
pub trait Tool {
    async fn execute(&self, args: &ToolArguments) -> Result<ToolResult>;
    fn schema(&self) -> ToolDefinition;
}
```

---

### 4. PoW Solver

```rust
pub struct PowSolver;

impl PowSolver {
    pub fn solve(required: &str, difficulty: &str) -> Option<String>;
    fn count_leading_zero_bits(hash: &[u8]) -> usize;
}
```

**Responsibilities:**
- Brute force SHA3-512 hashing
- Find seed that produces hash with N leading zero bits
- Timeout after configurable duration

**Algorithm:**
- Iterate: `seed_{0}` to `seed_{999999}`
- Hash: `SHA3-512(seed + required)`
- Check: count leading zero bits >= difficulty
- Return: first matching seed or None

**Performance:**
- Target: < 5ms average (most challenges are low difficulty)
- Worst case: 5s timeout

---

### 5. Stream Transformer

```rust
pub struct StreamTransformer {
    previous_content: String,
}

impl StreamTransformer {
    pub fn transform_chunk(&mut self, chunk: ChatGPTChunk) -> OpenAIChunk;
}
```

**Responsibilities:**
- Convert ChatGPT accumulated chunks to OpenAI deltas
- Track previous content to compute deltas
- Handle thinking model reasoning_content separately

**Transformation:**
```
ChatGPT: {content: "Hello world"}
         {content: "Hello world!"}
         
OpenAI:  {delta: {content: "Hello world"}}
         {delta: {content: "!"}}
```

---

## Data Flow

### Request Flow: Chat Completion

```
1. Client sends POST /v1/chat/completions
   ↓
2. Axum router → chat_completions handler
   ↓
3. Check/refresh access token (AuthManager)
   ↓
4. Determine mode:
   - Has client tools? → Stateless mode
   - No client tools? → Stateful mode
   ↓
5. Stateful mode:
   a. Hash messages (SHA-256)
   b. Lookup conversation cache
   c. Build request with conversation_id + parent_message_id
   
   Stateless mode:
   a. Inject tool prompt preamble
   b. Build new conversation request
   ↓
6. Solve PoW if challenge present
   ↓
7. Send request to ChatGPT backend
   ↓
8. Handle 401: refresh token, retry once
   ↓
9. Streaming?
   Yes → Transform stream (accumulated → delta)
   No  → Parse full response
   ↓
10. Tool calls present?
    Yes → Execute tools, recurse with results
    No  → Return response
    ↓
11. Cache conversation mapping (stateful mode)
    ↓
12. Return OpenAI-formatted response to client
```

### Tool Execution Flow

```
1. Parse tool calls from model response
   - Extract JSON between TOOL_CALL_START/END markers
   - Validate against schemas
   ↓
2. For each tool call:
   a. Route to appropriate tool executor
   b. Validate arguments
   c. Check security constraints
   d. Execute tool
   e. Capture result/error
   ↓
3. Format tool results as messages
   ↓
4. Append to conversation:
   - Assistant message with tool_calls
   - Tool result messages
   ↓
5. Recursive call to chat completion handler
   ↓
6. Return final response to client
```

---

## State Management

### Application State

```rust
pub struct AppState {
    // Shared across all requests
    auth_token: Arc<RwLock<Option<(String, Instant)>>>,
    conversations: Arc<RwLock<HashMap<String, ConversationContext>>>,
    http_client: reqwest::Client,
    tools: Arc<ToolExecutor>,
    config: Arc<Config>,
}
```

**Lifecycle:**
- Created at server startup
- Shared via `Arc` (cheap clones)
- Lives for entire process lifetime
- Cleared on restart (no persistence)

### Concurrency Model

**Read-Heavy Paths (Fast):**
```rust
// Multiple readers can access simultaneously
let token = state.auth_token.read().await;
let ctx = state.conversations.read().await.get(hash);
```

**Write Paths (Slow):**
```rust
// Exclusive access for updates
let mut token = state.auth_token.write().await;
*token = Some((new_token, expiry));
```

**No Locks Held Across Await:**
- Acquire lock
- Clone/read data
- Drop lock
- Do async work
- Acquire lock again if needed to write

---

## Security Architecture

### Authentication Security

**Session Token Protection:**
- Never logged or exposed in responses
- Loaded from environment only
- Not stored in any persistent format

**Access Token Handling:**
- In-memory only (RwLock)
- Expired tokens discarded
- Single retry on 401

### Tool Security

**Filesystem Tool:**
```rust
pub struct FilesystemSecurity {
    allowed_directories: Vec<PathBuf>,  // Whitelist
    max_file_size: usize,                // 10MB default
}
```

**HTTP Tool:**
```rust
pub struct HTTPSecurity {
    blocked_hosts: HashSet<String>,      // localhost, 127.0.0.1, etc.
    allowed_domains: Option<HashSet<String>>,  // Whitelist if set
    max_response_size: usize,            // 10MB default
    timeout: Duration,                   // 30s default
}
```

**Shell Tool:**
```rust
pub struct ShellSecurity {
    allowed_commands: HashSet<String>,   // Whitelist only
    timeout: Duration,                   // 30s default
    max_output: usize,                   // 1MB default
}
```

**Security Principles:**
- Whitelist > Blacklist
- Fail closed (deny by default)
- Size limits on all operations
- Timeouts on all blocking operations

### Network Security

**Outbound Requests:**
- HTTPS required for external requests
- Localhost blocked by default
- Private IP ranges blocked
- Domain whitelist configurable

**Inbound Requests:**
- Optional API key authentication
- CORS configured for local development
- No rate limiting (personal use)

---

## Performance Considerations

### Memory Management

**Target Memory Usage:** < 100MB steady state

**Memory Layout:**
```
Rust Binary:           ~10MB
Conversation Cache:    ~1MB (100 conversations × ~10KB each)
HTTP Client Pool:      ~5MB (connection buffers)
Token Cache:           < 1KB
Tool Executor:         ~1MB (buffers)
Request Buffers:       ~10MB (streaming)
Overhead:              ~20MB (Tokio runtime, allocator)
─────────────────────────────
Total:                 ~50MB typical, < 100MB peak
```

**Cache Sizing:**
- No hard limits (won't hit them with 1-3 users)
- Conversation cache: unlimited (personal use)
- HTTP connection pool: 10 connections default

### CPU Optimization

**Hot Paths:**
1. Token cache lookup (RwLock read)
2. Conversation cache lookup (HashMap read)
3. Stream transformation (string operations)

**Optimization Strategies:**
- Zero-copy where possible (Bytes, Arc)
- Avoid allocations in hot paths
- Reuse HTTP client (connection pooling)
- Compile with LTO and opt-level=3

**PoW Solving:**
- CPU-bound operation (SHA3-512 brute force)
- Typical: < 5ms (low difficulty)
- Worst case: 5s timeout
- Future: parallel solving with rayon if needed

### Compilation Optimization

```toml
[profile.release]
opt-level = 3           # Maximum optimizations
lto = "fat"             # Link-time optimization
codegen-units = 1       # Single codegen unit (slower build, faster binary)
strip = true            # Strip debug symbols
panic = "abort"         # Smaller binary, faster unwinding
```

**Results:**
- Binary size: ~5-10MB
- Build time: ~1-2 minutes
- Startup time: < 100ms
- Runtime performance: Near C++ levels

---

## Deployment Architecture

### Single Binary Deployment

```
conduit/
├── conduit    # Rust binary
├── dashboard/
│   └── dist/              # Pre-built TypeScript dashboard
└── .env                   # Configuration
```

**Startup:**
```bash
$ ./conduit
[INFO] Loading configuration from .env
[INFO] Starting HTTP server on 0.0.0.0:3000
[INFO] Dashboard available at http://localhost:3000
[INFO] API available at http://localhost:3000/v1
[INFO] Server ready
```

### Docker Deployment

```dockerfile
FROM debian:bookworm-slim
WORKDIR /app
COPY conduit ./
COPY dashboard/dist ./dashboard/dist
EXPOSE 3000
CMD ["./conduit"]
```

**Resource Limits:**
- Memory: 512MB minimum, 1GB comfortable
- CPU: 1 core minimum, 2 cores ideal
- Disk: 50MB (binary + dashboard)

### Render Deployment

```yaml
services:
  - type: web
    name: chatgpt-proxy-rust
    env: docker
    plan: starter
    envVars:
      - key: CHATGPT_SESSION_TOKEN
        sync: false
      - key: PORT
        value: 3000
```

**Render Specifics:**
- Auto-restart on crashes
- Logs to stdout (Tracing integration)
- Health checks on root `/`
- Environment variables via dashboard

---

## Scalability (Future)

**Current Design:** Optimized for 1-3 concurrent users

**If Scaling Needed:**

1. **Horizontal Scaling:**
   - Add load balancer (HAProxy/Nginx)
   - Multiple instances behind LB
   - Requires: shared session storage (Redis)
   - Requires: sticky sessions OR distributed cache

2. **Vertical Scaling:**
   - Current design supports ~10 concurrent users per instance
   - Bottleneck: ChatGPT backend, not proxy
   - Memory: linear with concurrent conversations

3. **Database Addition:**
   - Add PostgreSQL for conversation persistence
   - Add Redis for token/cache sharing
   - Add Qdrant/Milvus for vector search

**Not implementing now:** Designed for personal use only

---

## Technology Stack

### Core Dependencies

| Crate | Version | Purpose |
|-------|---------|---------|
| `axum` | 0.7 | Web framework |
| `tokio` | 1.x | Async runtime |
| `reqwest` | 0.11 | HTTP client |
| `serde` | 1.x | Serialization |
| `serde_json` | 1.x | JSON parsing |
| `sha3` | 0.10 | PoW hashing |
| `sha2` | 0.10 | Message hashing |
| `tower-http` | 0.5 | HTTP middleware |
| `tracing` | 0.1 | Logging |
| `dotenv` | 0.15 | Config loading |

### Total Dependency Count

- Direct dependencies: ~10
- Transitive dependencies: ~50 (Tokio ecosystem)
- Total compiled crates: ~60

**Dependency Policy:**
- Well-maintained crates only (last update < 6 months)
- Prefer standard ecosystem (Tokio, Serde)
- Avoid unmaintained or experimental crates
- Minimal transitive dependencies

---

## Related Documents

- **PRD:** `docs/PRD.md` - Product requirements
- **Phases:** `docs/PHASES.md` - Implementation phases
- **Tasks:** `docs/TASKS.md` - Task tracking
- **Rules:** `docs/RULES.md` - Development rules
- **Design Spec:** `docs/superpowers/specs/2026-07-16-rust-migration-design.md`

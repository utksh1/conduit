# Conduit

[![Rust](https://img.shields.io/badge/rust-1.75+-orange.svg)](https://www.rust-lang.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Binary Size](https://img.shields.io/badge/binary-5.1MB-green.svg)](Cargo.toml)

A high-performance Rust proxy that transforms ChatGPT's web interface into an OpenAI-compatible API. Use your ChatGPT subscription with any tool that supports the OpenAI protocol — Cursor, Continue, custom scripts, and more.

---

## Features

### Core Capabilities
- **OpenAI-Compatible API** — Drop-in replacement for `/v1/chat/completions` and `/v1/models`
- **Automatic Token Management** — Refreshes session tokens on expiry with exponential backoff retry
- **Advanced Proof-of-Work Solver** — Dual-mode solver with browser fingerprinting
  - **New Algorithm**: OmniRoute-compatible with 18-element prekey config (hex prefix comparison)
  - **Legacy Support**: Original SHA3-512 solver with leading zero bits (backward compatible)
  - **Sentinel Prepare Token**: Two-step PoW process for enhanced challenge handling
- **Stateful Conversations** — Maps OpenAI message histories to ChatGPT threads via SHA-256 fingerprinting
- **SSE Streaming** — Full support for real-time streaming responses with delta computation
- **Continue Generation** — Automatically handles max_tokens cutoffs by continuing responses

### Cloudflare & Bot Detection Evasion
- **🌐 Browser-Like Headers** — Complete Firefox 152 header emulation with OAI-specific fields
  - Stable device ID generation (SHA-256 of session token)
  - Random session IDs per conversation
  - Sec-Fetch-* headers, proper Accept-Encoding
- **Advanced Cookie Handling** — Supports all ChatGPT token formats
  - Chunked tokens (`__Secure-next-auth.session-token.0`, `.1`, `.2`)
  - Unchunked tokens (single value)
  - Full Cookie header parsing
  - Cloudflare cookie preservation (cf_clearance, __cf_bm, _cfuvid)
  - Automatic token rotation handling
- **Session Warmup System** — Mimics browser page load to reduce PoW difficulty
  - LRU cache with 60-second TTL (200 max entries)
  - Parallel warmup to 3 endpoints before conversations
  - Non-fatal failure handling
- **Browser Fingerprinting** — 18-element prekey config matching real browsers
  - Randomized screen sizes, CPU cores, navigator keys
  - Dynamic DPL (deployment hash) scraping from chatgpt.com
  - Webpack chunk URL extraction
  - 60-minute cache with fallback defaults

### Tool System
- **Chimera-Inspired Tools** — Execute filesystem, HTTP, shell, and code analysis operations
- **Security Sandboxing** — Whitelist-based access control for all tools
  - **Filesystem**: Directory restrictions, size limits, path traversal protection
  - **HTTP**: SSRF protection, domain allowlists, response size limits
  - **Shell**: Command whitelisting, output truncation
  - **Code**: Safe analysis without execution

### Performance & Deployment
- **Tiny Footprint** — 5.1MB optimized binary with LTO and symbol stripping
- **Memory Efficient** — LRU conversation cache (max 1000), <100MB typical usage
- **Docker Ready** — Multi-stage Dockerfile with dependency caching
- **Render Compatible** — Includes `render.yaml` for one-click deployment

### Additional Features
- **Optional Dashboard** — Web UI served from `dashboard/dist` (build separately)
- **Thinking Models** — Support for o1, o3, and reasoning-enabled models
- **API Key Protection** — Optional `PROXY_API_KEY` to restrict access
- **Health Checks** — `/health` endpoint for monitoring and load balancers

---

## Quick Start

### Prerequisites

- **Rust 1.75+** — Install via [rustup](https://rustup.rs/)
- **ChatGPT session token** — See [Getting Your Session Token](#-getting-your-session-token)

### Installation

```bash
# Clone the repository
git clone https://github.com/utksh1/conduit.git
cd conduit

# Copy environment template
cp .env.example .env

# Edit .env and add your CHATGPT_SESSION_TOKEN
nano .env
```

### Run in Development

```bash
cargo run
```

Server starts on `http://127.0.0.1:3040`

### Build Dashboard (Optional)

To use the web interface, you need to build the frontend dashboard:

```bash
cd dashboard
npm install
npm run build
cd ..
```

The Conduit proxy will automatically serve the dashboard from `dashboard/dist` when you start the server.

### Build Optimized Release

```bash
cargo build --release
./target/release/conduit
```

### Docker

```bash
# Build image
docker build -t chatgpt-proxy-rust .

# Run container
docker run -p 3040:3040 \
  -e CHATGPT_SESSION_TOKEN=your_token_here \
  -e ALLOWED_DIRECTORIES=/tmp \
  chatgpt-proxy-rust
```

### Deploy to Render

1. Push repository to GitHub
2. Import repository on Render
3. Select `render.yaml` configuration
4. Set `CHATGPT_SESSION_TOKEN` in environment variables
5. Deploy

---

## Configuration

All configuration via environment variables (`.env` file supported):

### Required

| Variable | Description |
|----------|-------------|
| `CHATGPT_SESSION_TOKEN` | Your ChatGPT session cookie (see below) |

### Server

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3040` | Server port |
| `HOST` | `0.0.0.0` | Server bind address |
| `PROXY_API_KEY` | — | Optional API key to protect the proxy |

### Tool Security

| Variable | Default | Description |
|----------|---------|-------------|
| `ALLOWED_DIRECTORIES` | — | Comma-separated paths for filesystem tool (e.g., `/home/user/projects,/tmp`) |
| `ALLOWED_SHELL_COMMANDS` | `ls,cat,grep,echo` | Comma-separated allowed shell commands |
| `TOOL_FORCE_THINKING` | `false` | Auto-upgrade to thinking model when tools present |
| `TOOL_THINKING_MODEL` | `o3` | Model to use when `TOOL_FORCE_THINKING=true` |

### Example `.env`

```env
# Required
CHATGPT_SESSION_TOKEN=eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIn0...

# Optional
PORT=3040
HOST=0.0.0.0
PROXY_API_KEY=my-secret-key-123

# Tool Security
ALLOWED_DIRECTORIES=/home/user/projects,/tmp
ALLOWED_SHELL_COMMANDS=ls,cat,grep,echo,find,wc
TOOL_FORCE_THINKING=false
```

### Session Token Formats

The proxy supports multiple session token formats:

1. **Simple Token Value** (most common):
   ```env
   CHATGPT_SESSION_TOKEN=eyJhbGciOiJkaXIi...
   ```

2. **Unchunked Cookie**:
   ```env
   CHATGPT_SESSION_TOKEN=__Secure-next-auth.session-token=eyJhbGciOiJkaXIi...
   ```

3. **Chunked Cookie** (when token is split across multiple cookies):
   ```env
   CHATGPT_SESSION_TOKEN=__Secure-next-auth.session-token.0=part1; __Secure-next-auth.session-token.1=part2; __Secure-next-auth.session-token.2=part3
   ```

4. **Full Cookie Header** (includes Cloudflare cookies):
   ```env
   CHATGPT_SESSION_TOKEN=__Secure-next-auth.session-token=token; cf_clearance=...; __cf_bm=...
   ```

All formats are automatically parsed and normalized.

---

## Getting Your Session Token

1. Go to [chatgpt.com](https://chatgpt.com) and log in
2. Open browser DevTools:
   - **Chrome/Edge**: Press `F12` or `Cmd+Option+I` (Mac)
   - **Firefox**: Press `F12` or `Cmd+Option+I` (Mac)
3. Navigate to **Application** (Chrome/Edge) or **Storage** (Firefox) tab
4. Expand **Cookies** → `https://chatgpt.com`
5. Find `__Secure-next-auth.session-token`
6. Copy the **Value** (long encrypted string)
7. Paste into `.env` as `CHATGPT_SESSION_TOKEN`

**Security Note**: Treat this like a password. Anyone with your session token has full access to your ChatGPT account.

---

## API Reference

### `POST /v1/chat/completions`

OpenAI-compatible chat completions endpoint.

**Request:**
```bash
curl http://localhost:3040/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-proxy-api-key" \
  -d '{
    "model": "gpt-4o",
    "messages": [
      {"role": "user", "content": "Hello!"}
    ],
    "stream": true
  }'
```

**Supported Parameters:**
- `model`: `gpt-4o`, `gpt-4o-mini`, `o1`, `o3` (actual model depends on your ChatGPT tier)
- `messages`: Array of message objects with `role` and `content`
- `stream`: Boolean for SSE streaming (default: false)
- `tools`: Array of tool definitions (triggers tool execution mode)

**Response:**
```json
{
  "id": "chatcmpl-123",
  "object": "chat.completion",
  "model": "gpt-4o",
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "content": "Hello! How can I help you?"
    },
    "finish_reason": "stop"
  }]
}
```

### `GET /v1/models`

Lists available models.

**Response:**
```json
{
  "data": [
    {"id": "gpt-4o", "object": "model"},
    {"id": "gpt-4o-mini", "object": "model"},
    {"id": "o1", "object": "model"},
    {"id": "o3", "object": "model"}
  ]
}
```

### `GET /health`

Health check endpoint (returns `"ok"`).

---

## Client Integration

### Cursor IDE

1. Open **Cursor Settings** → **Models**
2. Under **OpenAI API**, override:
   - **Base URL**: `http://localhost:3040/v1`
   - **API Key**: Your `PROXY_API_KEY` (or any value if not set)
3. Save and start chatting

### Continue (VS Code Extension)

Edit `~/.continue/config.json`:

```json
{
  "models": [{
    "title": "ChatGPT Proxy",
    "provider": "openai",
    "model": "gpt-4o",
    "apiBase": "http://localhost:3040/v1",
    "apiKey": "your-proxy-api-key"
  }]
}
```

### Kilo Code (VS Code Extension)

Edit `~/.config/kilo/kilo.jsonc`:

```jsonc
{
  "provider": {
    "chatgpt-proxy": {
      "name": "ChatGPT Proxy",
      "api": "http://localhost:3040/v1",
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "apiKey": "your-proxy-api-key",
        "baseURL": "http://localhost:3040/v1"
      },
      "models": {
        "gpt-4o": { "name": "GPT-4o" },
        "o3": { "name": "o3 (Reasoning)" }
      }
    }
  },
  "model": "chatgpt-proxy/gpt-4o"
}
```

### LobeChat / NextChat

Configure custom OpenAI endpoint:
- **Base URL**: `http://localhost:3040/v1`
- **API Key**: Your `PROXY_API_KEY`

### Custom Scripts (Python)

```python
from openai import OpenAI

client = OpenAI(
    api_key="your-proxy-api-key",
    base_url="http://localhost:3040/v1"
)

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hello!"}]
)

print(response.choices[0].message.content)
```

---

## Tool System

The proxy includes a Chimera-inspired tool execution system that allows the model to interact with your environment.

### Available Tools

#### Filesystem Tool
```bash
# Allow specific directories
ALLOWED_DIRECTORIES=/home/user/projects,/tmp
```

Operations: `read_file`, `write_file`

Security:
- Path traversal protection (canonicalization)
- Directory whitelist enforcement
- File size limits (10MB)

#### HTTP Tool

Operations: `http_request` (GET, POST, PUT, DELETE)

Security:
- SSRF protection (blocks localhost, private IPs)
- Optional domain allowlist
- Response size limits (10MB)
- 30-second timeout

#### Shell Tool

```bash
# Whitelist commands
ALLOWED_SHELL_COMMANDS=ls,cat,grep,echo,find,wc,git
```

Security:
- Command whitelist enforcement
- Output size limits (1MB)
- Stderr capture

#### Code Analysis Tool

Operations: `lint`, `format` (stub implementation)

### Tool Call Format

The model responds with markdown-formatted tool calls:

````markdown
I'll read the file for you.

```tool_call
{
  "tool_calls": [
    {
      "id": "call_1",
      "name": "read_file",
      "arguments": {"path": "/tmp/example.txt"}
    }
  ]
}
```
````

The proxy:
1. Parses the tool call
2. Executes the tool (with security checks)
3. Sends results back to the model
4. Model generates final response

---

## Project Structure

```text
src/
├── main.rs              # Server entry, router, state initialization
├── config.rs            # Environment configuration & security config
├── error.rs             # Application error types (OpenAI-compatible)
├── lib.rs               # Public module exports
│
├── auth/
│   ├── mod.rs
│   ├── cookie.rs        # Advanced cookie parsing (chunked, rotation, Cloudflare)
│   └── token_manager.rs # Token caching, refresh, expiry checks
│
├── chatgpt/
│   ├── mod.rs
│   ├── client.rs        # ChatGPT HTTP client, 401 retry, PoW handling
│   ├── models.rs        # Request/response types
│   ├── headers.rs       # Browser-like header builder with OAI fields
│   ├── warmup.rs        # Session warmup cache (LRU, 60s TTL)
│   ├── prekey.rs        # 18-element browser fingerprint config
│   ├── dpl.rs           # Dynamic deployment hash scraper
│   ├── pow.rs           # Dual-mode PoW solver (new + legacy)
│   └── sentinel.rs      # Sentinel prepare token (two-step PoW)
│
├── conversation/
│   ├── mod.rs
│   ├── cache.rs         # In-memory conversation cache (LRU)
│   └── hash.rs          # SHA-256 message hashing for stateful mapping
│
├── routes/
│   ├── mod.rs
│   ├── chat.rs          # POST /v1/chat/completions (tool loop, streaming)
│   └── models.rs        # GET /v1/models
│
├── streaming/
│   ├── mod.rs
│   └── transformer.rs   # SSE stream transformer (ChatGPT → OpenAI deltas)
│
└── tools/
    ├── mod.rs
    ├── code.rs          # Code analysis tool (stub)
    ├── executor.rs      # Tool dispatch router
    ├── filesystem.rs    # Filesystem tool (sandboxed)
    ├── http.rs          # HTTP request tool (SSRF-protected)
    ├── parser.rs        # Tool call marker parser (Chimera approach)
    ├── prompt.rs        # Tool prompt injection
    ├── registry.rs      # Tool definitions & registry
    └── shell.rs         # Shell execution tool (whitelisted)

tests/
├── auth_tests.rs        # Token management tests
├── config_tests.rs      # Configuration loading tests
├── conversation_tests.rs # Hashing & caching tests
├── pow_tests.rs         # Proof-of-work solver tests (both modes)
├── routes_tests.rs      # Route handler tests
├── streaming_tests.rs   # SSE streaming tests
├── cookie_tests.rs      # Chunked token parsing tests (9 tests)
├── headers_tests.rs     # Browser header generation tests (8 tests)
├── warmup_tests.rs      # Session warmup cache tests (7 tests)
├── prekey_tests.rs      # Fingerprint config tests (8 tests)
├── dpl_tests.rs         # DPL scraper tests (5 tests)
├── sentinel_tests.rs    # Sentinel prepare token tests (1 test)
└── tools_*.rs           # Tool-specific tests (19 tests total)

docs/
├── PRD.md               # Product requirements
├── ARCHITECTURE.md      # Technical architecture
├── PHASES.md            # Implementation phases
├── TASKS.md             # Task tracking
├── RULES.md             # Development rules
└── TESTING.md           # Testing strategy

TESTING_SUMMARY.md       # Phase 1+2 testing results
dashboard/               # Optional web UI (Vite + React + TypeScript)
```

---

## Testing

### Run All Tests

```bash
# Run all tests (49 total)
cargo test --all-features

# Run with output
cargo test -- --nocapture

# Run specific test
cargo test test_token_expiry

# Run integration tests only
cargo test --test integration
```

### Test Coverage by Module

| Module | Tests | Status |
|--------|-------|--------|
| `headers.rs` | 8 | Device ID, session ID, OAI headers |
| `cookie.rs` | 9 | Chunked/unchunked parsing, rotation |
| `warmup.rs` | 7 | LRU cache, TTL, parallel warmup |
| `prekey.rs` | 8 | Config structure, randomization |
| `dpl.rs` | 5 | HTML parsing, fallbacks, cache |
| `pow.rs` | 5 | Both solvers, hex prefix, legacy |
| `sentinel.rs` | 1 | Prepare token structure |
| `existing` | 6 | Auth, config, conversations, etc. |
| **Total** | **49** | **100% passing** |

### Test Coverage

```bash
# Install coverage tool
cargo install cargo-llvm-cov

# Generate coverage report
cargo llvm-cov --all-features --workspace --lcov --output-path lcov.info
```

### Manual Testing Checklist

See `TESTING_SUMMARY.md` for comprehensive Phase 1+2 testing results with real ChatGPT API.

---

## Troubleshooting

### Server Won't Start

**Error:** `Failed to load configuration: Missing CHATGPT_SESSION_TOKEN`

**Fix:** Ensure `.env` file exists with valid token:
```bash
cp .env.example .env
# Edit .env and add your token
```

### Authentication Errors

**Error:** `Authentication error: Failed to refresh token, status: 403`

**Cause:** Session token expired or invalid

**Fix:**
1. Re-login to [chatgpt.com](https://chatgpt.com)
2. Open DevTools → Application → Cookies
3. Copy fresh `__Secure-next-auth.session-token`
4. Update `.env` with new token
5. Restart server

**Tip:** If you see HTML responses instead of JSON, your token is definitely expired.

### Session Token Formats

**Problem:** Token not recognized

**Solutions:**

1. **Simple token value** (recommended):
   ```env
   CHATGPT_SESSION_TOKEN=eyJhbGciOiJkaXIi...
   ```

2. **If using chunked tokens** (`.0`, `.1`, `.2`):
   ```env
   CHATGPT_SESSION_TOKEN=__Secure-next-auth.session-token.0=part1; __Secure-next-auth.session-token.1=part2
   ```

3. **Include Cloudflare cookies** for better success:
   ```env
   CHATGPT_SESSION_TOKEN=__Secure-next-auth.session-token=token; cf_clearance=xyz; __cf_bm=abc
   ```

### PoW Challenge Issues

**Problem:** Frequent PoW challenges or timeouts

**Causes:**
- Datacenter IP detected
- Missing session warmup
- Incorrect browser fingerprinting

**Fixes:**
1. Check logs for "Session warmup" - should run before conversations
2. Verify headers in debug mode: `RUST_LOG=debug cargo run`
3. Consider using residential IP or VPN
4. Reduce request frequency

### Cloudflare Blocks

**Error:** `Cloudflare challenge encountered`

**Solutions:**
1. **Use residential IP** - Most effective
2. **Add Cloudflare cookies** to session token (cf_clearance, __cf_bm)
3. **Reduce request rate** - Wait 1-2 seconds between requests
4. **Check IP reputation** - Some VPNs/proxies are blocked
5. **Session warmup** - Automatically enabled, mimics browser behavior

### Tool Execution Errors

**Error:** `Path /some/path is outside allowed directories`

**Fix:** Add directory to `ALLOWED_DIRECTORIES`:
```env
ALLOWED_DIRECTORIES=/home/user/projects,/tmp,/some/path
```

**Error:** `Command 'xyz' is not in the allowed commands whitelist`

**Fix:** Add command to `ALLOWED_SHELL_COMMANDS`:
```env
ALLOWED_SHELL_COMMANDS=ls,cat,grep,echo,xyz
```

### Connection Issues

**Problem:** Client can't connect

**Checklist:**
1. Server running? `curl http://localhost:3040/health`
2. Correct port? Default is `3040`
3. Connecting remotely? Set `HOST=0.0.0.0`
4. Using `PROXY_API_KEY`? Pass it as API key in client

### Debug Logging

```bash
# Debug level
RUST_LOG=debug cargo run

# Trace level (very verbose)
RUST_LOG=trace cargo run

# Debug only this crate
RUST_LOG=chatgpt_to_api_rust=debug cargo run
```

### More Help

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for detailed troubleshooting guide.

---

## Performance

### Metrics (Measured)

- **Binary Size**: 5.1MB (optimized release with LTO)
- **Memory Usage**: <50MB idle, <100MB under load
- **PoW Solve Time**: 
  - New algorithm: 10-100ms (hex prefix, prekey config)
  - Legacy algorithm: 0-5ms (leading zero bits)
- **Startup Time**: <100ms
- **Session Warmup**: 3 parallel requests, ~200-500ms total

### Optimizations

- **LTO (Link-Time Optimization)** enabled in release profile
- **Symbol stripping** for smaller binary
- **Multi-stage Docker build** for minimal image size
- **LRU conversation cache** with 1000-item limit
- **LRU warmup cache** with 200-item limit, 60s TTL
- **Connection pooling** via reqwest with HTTP/2
- **Gzip decompression** for ChatGPT responses
- **Parallel warmup** to 3 endpoints simultaneously
- **DPL cache** with 60-minute TTL

### Cloudflare Evasion Success Rate

With Phase 1+2 improvements:
- Browser-like headers reduce bot detection
- Session warmup lowers PoW difficulty
- Prekey config matches real browser fingerprints
- Cloudflare cookies properly preserved
- Still works best from residential IPs
- Datacenter IPs may face challenges

---

## Disclaimers

### Terms of Service

This is an **unofficial tool** that uses ChatGPT's web interface. It violates OpenAI's terms of service regarding automated scrapers. Use strictly for:
- Personal evaluation
- Research purposes
- Non-commercial experimentation

**Not recommended for production use.**

### Account Security

- **Keep your session token secure** — treat it like a password
- Never commit session tokens to git
- Session tokens typically last 1-2 months before expiring
- The proxy automatically refreshes access tokens, not session tokens

### Rate Limits

- Subject to same rate limits as ChatGPT web interface
- Fast parallel requests may trigger Cloudflare challenges
- Proxy detects 429 (rate limit) and 403 (Cloudflare) responses
- Consider request throttling for heavy use

### IP Blocks

- ChatGPT may block datacenter IPs
- Works best from residential IPs
- VPN/proxy IPs may be blocked
- Render/AWS deployments may face blocks

---

## Contributing

Contributions welcome! Please:

1. Read `docs/RULES.md` for code style and conventions
2. Add tests for new features
3. Update documentation
4. Follow commit message format: `type: description`

### Development

```bash
# Format code
cargo fmt --all

# Lint
cargo clippy --all-targets --all-features -- -D warnings

# Run tests
cargo test --all-features

# Build docs
cargo doc --open
```

---

## License

MIT License - see [LICENSE](LICENSE) file for details.

---

## Acknowledgments

- **OmniRoute** — Architecture inspiration for advanced Cloudflare evasion (Phase 1+2 implementation)
- **chat2api** — Reference for enhanced PoW solver and browser fingerprinting
- **Chimera** — Inspiration for tool system architecture
- **OpenAI** — ChatGPT and OpenAI API specification
- **Rust Community** — Excellent async ecosystem (Tokio, Axum, Reqwest)

---

## Documentation

- **[TESTING_SUMMARY.md](TESTING_SUMMARY.md)** — Phase 1+2 implementation and testing results
- **[PRD.md](docs/PRD.md)** — Product requirements and user stories
- **[ARCHITECTURE.md](docs/ARCHITECTURE.md)** — Technical architecture and design decisions
- **[PHASES.md](docs/PHASES.md)** — Implementation phases and milestones
- **[TESTING.md](docs/TESTING.md)** — Testing strategy and test pyramid
- **[TROUBLESHOOTING.md](TROUBLESHOOTING.md)** — Common issues and solutions
- **[TASKS.md](docs/TASKS.md)** — Task tracking and progress

---

## Links

- **Repository**: [GitHub](https://github.com/utksh1/conduit)
- **Issues**: [GitHub Issues](https://github.com/utksh1/conduit/issues)
- **Discussions**: [GitHub Discussions](https://github.com/utksh1/conduit/discussions)

---

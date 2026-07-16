# Development Rules & Conventions

**Project**: ChatGPT-to-API Rust Migration  
**Version**: 1.0  
**Last Updated**: 2026-07-16

---

## Table of Contents

1. [Code Style](#code-style)
2. [Rust Conventions](#rust-conventions)
3. [Error Handling](#error-handling)
4. [Testing Requirements](#testing-requirements)
5. [Documentation Standards](#documentation-standards)
6. [Git Workflow](#git-workflow)
7. [Security Guidelines](#security-guidelines)
8. [Performance Rules](#performance-rules)

---

## Code Style

### Rustfmt Configuration

**Always run rustfmt before committing:**

```bash
cargo fmt --all
```

**Configuration (`.rustfmt.toml`):**
```toml
edition = "2021"
max_width = 100
tab_spaces = 4
use_small_heuristics = "Default"
```

### Naming Conventions

**Modules:** Snake case
```rust
// Good
mod auth_manager;
mod tool_executor;

// Bad
mod AuthManager;
mod toolExecutor;
```

**Types:** PascalCase
```rust
// Good
struct ConversationCache;
enum ToolError;

// Bad
struct conversation_cache;
enum tool_error;
```

**Functions/Variables:** Snake case
```rust
// Good
fn get_or_refresh_token() -> Result<String>;
let conversation_id = "abc123";

// Bad
fn GetOrRefreshToken() -> Result<String>;
let conversationId = "abc123";
```

**Constants:** SCREAMING_SNAKE_CASE
```rust
// Good
const MAX_CACHE_SIZE: usize = 10_000;
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(60);

// Bad
const maxCacheSize: usize = 10_000;
const default_timeout: Duration = Duration::from_secs(60);
```

### File Organization

**Module structure:**
```rust
// src/auth/mod.rs
mod token_manager;  // Private submodule
mod session;        // Private submodule

pub use token_manager::AuthManager;  // Public re-export
pub use session::SessionHandler;     // Public re-export
```

**Imports order:**
```rust
// 1. Standard library
use std::collections::HashMap;
use std::sync::Arc;

// 2. External crates
use axum::{Router, Json};
use serde::{Serialize, Deserialize};

// 3. Internal modules
use crate::auth::AuthManager;
use crate::error::AppError;
```

---

## Rust Conventions

### Ownership & Borrowing

**Prefer borrowing over cloning:**
```rust
// Good
fn process_message(msg: &Message) -> Result<()> { ... }

// Bad (unless clone is necessary)
fn process_message(msg: Message) -> Result<()> { ... }
```

**Use Arc for shared ownership:**
```rust
// Good - shared state
pub struct AppState {
    conversations: Arc<RwLock<HashMap<String, Context>>>,
}

// Bad - unnecessary Rc in async code
pub struct AppState {
    conversations: Rc<RefCell<HashMap<String, Context>>>,
}
```

### Async/Await

**Always use `.await` explicitly:**
```rust
// Good
let token = auth_manager.get_token().await?;

// Bad (won't compile, but conceptually wrong)
let token = auth_manager.get_token()?;
```

**No locks held across .await:**
```rust
// Good
let data = {
    let cache = state.cache.read().await;
    cache.get(key).cloned()
};
process(data).await;

// Bad - lock held during async operation
let cache = state.cache.read().await;
let data = cache.get(key);
process(data).await;
drop(cache);
```

### Error Handling

**Use ? operator for propagation:**
```rust
// Good
fn fetch_data() -> Result<Data> {
    let response = http_client.get(url).send().await?;
    let data = response.json().await?;
    Ok(data)
}

// Bad - manual error handling
fn fetch_data() -> Result<Data> {
    match http_client.get(url).send().await {
        Ok(response) => {
            match response.json().await {
                Ok(data) => Ok(data),
                Err(e) => Err(e.into()),
            }
        }
        Err(e) => Err(e.into()),
    }
}
```

**Custom error types:**
```rust
// Good - specific error variants
#[derive(Debug)]
pub enum AppError {
    TokenRefreshFailed(String),
    InvalidSessionToken,
    ChatGPTError { status: u16, message: String },
}

// Bad - generic error wrapper
pub struct AppError(Box<dyn std::error::Error>);
```

---

## Error Handling

### Error Types

**Define domain-specific errors:**
```rust
#[derive(Debug, thiserror::Error)]
pub enum AuthError {
    #[error("Token refresh failed: {0}")]
    RefreshFailed(String),
    
    #[error("Invalid session token")]
    InvalidSessionToken,
    
    #[error("Network error: {0}")]
    Network(#[from] reqwest::Error),
}
```

### Error Context

**Add context to errors:**
```rust
// Good
let token = refresh_token()
    .await
    .context("Failed to refresh access token")?;

// Better (for AppError)
let token = refresh_token()
    .await
    .map_err(|e| AppError::TokenRefreshFailed(e.to_string()))?;
```

### Logging Errors

**Log errors at appropriate levels:**
```rust
// Error level - actionable problems
tracing::error!("Failed to refresh token: {}", err);

// Warn level - degraded but functional
tracing::warn!("PoW solve took {}ms, expected < 5ms", elapsed);

// Info level - normal operations
tracing::info!("Token refreshed successfully");

// Debug level - detailed diagnostics
tracing::debug!("Cached conversation for hash: {}", hash);
```

---

## Testing Requirements

### Unit Tests

**Test critical business logic:**
```rust
#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_message_hashing() {
        let messages = vec![
            Message { role: "user", content: "Hello" },
        ];
        let hash1 = hash_messages(&messages);
        let hash2 = hash_messages(&messages);
        assert_eq!(hash1, hash2);
    }
    
    #[tokio::test]
    async fn test_token_expiry_check() {
        let past = Instant::now() - Duration::from_secs(60);
        assert!(is_token_expired(past));
        
        let future = Instant::now() + Duration::from_secs(60);
        assert!(!is_token_expired(future));
    }
}
```

**Minimum coverage:**
- PoW solver: 100% (critical path)
- Message hashing: 100%
- Tool parsers: 90%+
- Auth logic: 80%+

### Integration Tests

**Test end-to-end flows:**
```rust
#[tokio::test]
async fn test_chat_completion_flow() {
    let app = create_test_app().await;
    let request = ChatCompletionRequest { ... };
    
    let response = app
        .oneshot(
            Request::builder()
                .uri("/v1/chat/completions")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_string(&request).unwrap()))
                .unwrap()
        )
        .await
        .unwrap();
    
    assert_eq!(response.status(), StatusCode::OK);
}
```

### Manual Testing Checklist

Before considering a phase complete:

- [ ] Connect Cursor IDE and send chat request
- [ ] Test streaming responses
- [ ] Test tool execution (filesystem, HTTP, shell)
- [ ] Test thinking models (o1, o3)
- [ ] Verify token refresh on 401
- [ ] Test dashboard UI
- [ ] Check memory usage under load
- [ ] Verify error messages are clear

---

## Documentation Standards

### Code Comments

**Comment complex logic only:**
```rust
// Good - explains non-obvious behavior
// ChatGPT sends accumulated content; we need to compute deltas
// by tracking previous content and using string prefix stripping
let delta = current.strip_prefix(&previous).unwrap_or(&current);

// Bad - states the obvious
// Increment counter
counter += 1;
```

### Doc Comments

**Public APIs require documentation:**
```rust
/// Fetches or refreshes the ChatGPT access token.
///
/// This method checks the cached token and returns it if still valid.
/// If the token is expired or missing, it refreshes using the session token.
///
/// # Errors
///
/// Returns `AuthError::RefreshFailed` if the refresh request fails.
///
/// # Examples
///
/// ```no_run
/// let token = auth_manager.get_token().await?;
/// ```
pub async fn get_token(&self) -> Result<String, AuthError> {
    // ...
}
```

### README Updates

**Keep README current:**
- Update when adding new features
- Document configuration changes
- Update client integration examples
- Keep troubleshooting section updated

---

## Git Workflow

### Commit Messages

**Format:**
```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation only
- `refactor`: Code refactoring
- `test`: Adding tests
- `chore`: Maintenance tasks

**Examples:**
```
feat(auth): implement reactive token refresh

- Check token expiry before each request
- Refresh on 401 with single retry
- Remove background refresh task

Fixes #42

---

fix(tools): validate tool arguments against schemas

Prevent invalid arguments from reaching tool executors.

---

docs(readme): update Cursor integration instructions
```

### Branch Strategy

**For personal use - simple workflow:**
```
main (default branch)
  ├── feature/phase-1-auth
  ├── feature/phase-2-tools
  └── feature/phase-3-polish
```

**Rules:**
- Work in feature branches for each phase
- Merge to main when phase is complete and tested
- Tag releases: `v1.0.0`, `v1.1.0`, etc.

### Commit Frequency

**Commit often:**
- After completing a logical unit of work
- Before switching tasks
- At the end of each session

**Don't commit:**
- Broken code (unless WIP tagged)
- Sensitive data (.env files)
- Build artifacts (target/, *.log)

---

## Security Guidelines

### Sensitive Data

**Never commit:**
- Session tokens
- Access tokens
- API keys
- `.env` files with real credentials

**Use .gitignore:**
```
.env
*.log
target/
.DS_Store
```

**Use .env.example:**
```env
# .env.example - safe to commit
CHATGPT_SESSION_TOKEN=your-token-here
PROXY_API_KEY=optional-api-key
```

### Input Validation

**Always validate external input:**
```rust
// Good
fn validate_path(path: &Path, allowed: &[PathBuf]) -> Result<()> {
    let canonical = path.canonicalize()?;
    
    if !allowed.iter().any(|dir| canonical.starts_with(dir)) {
        return Err(ToolError::PathNotAllowed);
    }
    
    Ok(())
}

// Bad - trusts user input
fn read_file(path: &str) -> Result<String> {
    std::fs::read_to_string(path)
}
```

### Tool Security

**Whitelist approach:**
```rust
// Good
const ALLOWED_COMMANDS: &[&str] = &["ls", "cat", "grep", "git"];

if !ALLOWED_COMMANDS.contains(&command) {
    return Err(ToolError::CommandNotAllowed);
}

// Bad - blacklist (incomplete)
if command == "rm" || command == "dd" {
    return Err(ToolError::DangerousCommand);
}
```

**Size limits:**
```rust
// Always enforce limits
const MAX_FILE_SIZE: usize = 10 * 1024 * 1024; // 10MB
const MAX_OUTPUT_SIZE: usize = 1 * 1024 * 1024; // 1MB
```

---

## Performance Rules

### Memory Efficiency

**Avoid unnecessary clones:**
```rust
// Good - borrow
fn process(data: &[u8]) -> Result<()> { ... }

// Good - move if consumed
fn consume(data: Vec<u8>) -> Result<()> { ... }

// Bad - unnecessary clone
fn process(data: Vec<u8>) -> Result<()> {
    let copy = data.clone();
    // ...
}
```

**Use Bytes for zero-copy:**
```rust
// Good - zero-copy
use bytes::Bytes;
let data = Bytes::from(vec![1, 2, 3]);
let slice = data.slice(0..2); // No allocation

// Bad - copying
let data = vec![1, 2, 3];
let slice = &data[0..2].to_vec(); // Allocates
```

### Async Performance

**Don't block the runtime:**
```rust
// Good - async version
let data = tokio::fs::read(path).await?;

// Bad - blocks runtime
let data = std::fs::read(path)?;

// Good - spawn_blocking for CPU-heavy work
let result = tokio::task::spawn_blocking(|| {
    // CPU-intensive work
    solve_pow(required, difficulty)
}).await?;
```

### Allocation Reduction

**Preallocate when size known:**
```rust
// Good
let mut buffer = String::with_capacity(1024);

// Bad
let mut buffer = String::new();
```

**Reuse allocations:**
```rust
// Good - reuse hasher
let mut hasher = Sha3_512::new();
for attempt in 0..1_000_000 {
    hasher.update(input.as_bytes());
    let hash = hasher.finalize_reset(); // Resets for next use
}

// Bad - allocate each time
for attempt in 0..1_000_000 {
    let hasher = Sha3_512::new();
    hasher.update(input.as_bytes());
    let hash = hasher.finalize();
}
```

---

## Code Review Checklist

Before marking a PR as ready:

### Functionality
- [ ] Code compiles without warnings
- [ ] All tests pass
- [ ] Manual testing completed
- [ ] Error cases handled
- [ ] Edge cases considered

### Code Quality
- [ ] Follows Rust conventions
- [ ] No unnecessary clones
- [ ] Error messages are clear
- [ ] Logging at appropriate levels
- [ ] No commented-out code

### Security
- [ ] Input validation present
- [ ] Security constraints enforced
- [ ] No sensitive data in code
- [ ] Size limits enforced
- [ ] Timeouts configured

### Performance
- [ ] No blocking operations in async code
- [ ] Locks not held across .await
- [ ] Allocations minimized
- [ ] Resource cleanup on error paths

### Documentation
- [ ] Public APIs documented
- [ ] Complex logic commented
- [ ] README updated if needed
- [ ] Configuration documented

---

## Tooling

### Required Tools

**Install before starting:**
```bash
# Rust toolchain
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Rustfmt (code formatter)
rustup component add rustfmt

# Clippy (linter)
rustup component add clippy
```

### Pre-Commit Checks

**Run before every commit:**
```bash
# Format code
cargo fmt --all

# Lint code
cargo clippy --all-targets --all-features -- -D warnings

# Run tests
cargo test

# Build release (occasionally)
cargo build --release
```

### VS Code Setup

**Recommended extensions:**
- rust-analyzer
- Even Better TOML
- crates (dependency management)

**Settings (.vscode/settings.json):**
```json
{
  "rust-analyzer.checkOnSave.command": "clippy",
  "editor.formatOnSave": true,
  "[rust]": {
    "editor.defaultFormatter": "rust-lang.rust-analyzer"
  }
}
```

---

## Common Pitfalls

### 1. Holding Locks Across Await

**Problem:**
```rust
// WRONG - lock held during await
let cache = state.cache.read().await;
let data = expensive_operation(cache.get(key)).await;
```

**Solution:**
```rust
// RIGHT - clone data, drop lock, then await
let data = {
    let cache = state.cache.read().await;
    cache.get(key).cloned()
};
let result = expensive_operation(data).await;
```

### 2. Blocking the Async Runtime

**Problem:**
```rust
// WRONG - blocks runtime
let data = std::fs::read(path)?;
```

**Solution:**
```rust
// RIGHT - async version
let data = tokio::fs::read(path).await?;

// OR use spawn_blocking for CPU work
let data = tokio::task::spawn_blocking(|| {
    std::fs::read(path)
}).await??;
```

### 3. Unnecessary Cloning

**Problem:**
```rust
// WRONG - clones on every call
fn process(state: AppState) -> Result<()> {
    let token = state.token.clone();
    // ...
}
```

**Solution:**
```rust
// RIGHT - borrow
fn process(state: &AppState) -> Result<()> {
    let token = &state.token;
    // ...
}
```

### 4. Ignoring Errors

**Problem:**
```rust
// WRONG - silently ignores error
let _ = refresh_token().await;
```

**Solution:**
```rust
// RIGHT - handle or propagate
refresh_token().await?;

// OR log and handle
if let Err(e) = refresh_token().await {
    tracing::error!("Token refresh failed: {}", e);
    return Err(e);
}
```

---

## Resources

### Rust Learning
- [The Rust Book](https://doc.rust-lang.org/book/)
- [Async Book](https://rust-lang.github.io/async-book/)
- [Tokio Tutorial](https://tokio.rs/tokio/tutorial)

### Crate Documentation
- [Axum Docs](https://docs.rs/axum/)
- [Reqwest Docs](https://docs.rs/reqwest/)
- [Serde Docs](https://serde.rs/)

### Tools
- [Clippy Lints](https://rust-lang.github.io/rust-clippy/master/)
- [Rustfmt Config](https://rust-lang.github.io/rustfmt/)

---

## Enforcement

**These rules are:**
- ✅ Guidelines for consistent code quality
- ✅ Enforced through code review
- ✅ Checked by Clippy where possible
- ❌ Not bureaucratic overhead — adapt as needed

**When in doubt:**
1. Check existing code for patterns
2. Run `cargo clippy` for suggestions
3. Prioritize clarity over cleverness
4. Ask before breaking conventions

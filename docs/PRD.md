# Product Requirements Document (PRD)

**Project**: ChatGPT-to-API Rust Migration  
**Version**: 1.0  
**Date**: 2026-07-16  
**Status**: Approved  
**Owner**: Personal Project

---

## Executive Summary

Migrate the existing Node.js ChatGPT-to-API proxy to Rust with enhanced tool execution capabilities, optimized for personal use (1-3 concurrent users). The system will maintain compatibility with OpenAI-compatible clients while adding robust tool execution inspired by the Chimera project.

---

## Problem Statement

### Current Issues with Node.js Implementation

1. **Token Refresh:** Access tokens expire without proper automatic refresh logic
2. **Tool Calling Reliability:** 4-pass parser is fragile and inconsistent
3. **Chain of Thought:** Thinking models (o1, o3, gpt-5-5-thinking) don't work properly
4. **Resource Concerns:** Proactive optimization for reduced memory/CPU usage on Render

### Goals

- Improve reliability and performance
- Fix existing bugs in the Node.js version
- Add robust tool execution system
- Optimize for personal-scale deployment (1-3 users)
- Maintain zero-modification compatibility with existing clients

---

## Target Users

**Primary User:** Solo developer / personal use  
**Concurrent Users:** 1-3 maximum  
**Deployment:** Single instance on Render (or local machine)

### User Personas

**Persona 1: Solo Developer**
- Uses Cursor/Continue/Kilo Code for development
- Wants ChatGPT web access through standard OpenAI API
- Needs tool execution (filesystem, shell, HTTP)
- Values reliability over features

---

## Requirements

### Functional Requirements

#### FR1: OpenAI API Compatibility
- **Priority:** P0 (Critical)
- **Description:** Must expose OpenAI-compatible API at `/v1/chat/completions`
- **Acceptance Criteria:**
  - Cursor, Continue, Kilo Code work without modification
  - Supports streaming and non-streaming responses
  - Returns OpenAI-format responses

#### FR2: ChatGPT Web Proxy
- **Priority:** P0 (Critical)
- **Description:** Proxy requests to ChatGPT web backend using session token
- **Acceptance Criteria:**
  - Authenticates with `__Secure-next-auth.session-token`
  - Automatically refreshes access tokens on 401
  - Solves Sentinel PoW challenges
  - Maintains conversation state across requests

#### FR3: Stateful Conversation Mapping
- **Priority:** P0 (Critical)
- **Description:** Map OpenAI message history to ChatGPT conversation threads
- **Acceptance Criteria:**
  - SHA-256 fingerprinting of message history
  - Cache lookup by message hash
  - Preserve conversation_id and parent_message_id
  - In-memory cache (no database)

#### FR4: Tool Execution System
- **Priority:** P1 (High)
- **Description:** Execute tools requested by the model
- **Tools Required:**
  - Filesystem (read, write, list, delete, mkdir)
  - HTTP (GET, POST, PUT, DELETE)
  - Shell (whitelisted commands)
  - Code Analysis (parse, lint)
- **Acceptance Criteria:**
  - Structured tool schemas (OpenAI format)
  - Single-pass parser with validation
  - Security constraints enforced
  - Tool results fed back into conversation

#### FR5: Thinking Model Support
- **Priority:** P1 (High)
- **Description:** Properly handle o1, o3, gpt-5-5-thinking models
- **Acceptance Criteria:**
  - Extract and stream reasoning_content separately
  - Tool calls parsed from content (not reasoning)
  - Chain of thought visible in responses

#### FR6: SSE Streaming
- **Priority:** P0 (Critical)
- **Description:** Stream responses in real-time
- **Acceptance Criteria:**
  - Transform ChatGPT accumulated chunks to OpenAI deltas
  - Server-Sent Events format
  - Works in Cursor/Continue streaming mode

#### FR7: Dashboard
- **Priority:** P2 (Medium)
- **Description:** Serve existing TypeScript dashboard
- **Acceptance Criteria:**
  - Static files served at `/`
  - Dashboard communicates with `/v1/*` API
  - No changes to existing dashboard code

### Non-Functional Requirements

#### NFR1: Performance
- **Startup Time:** < 100ms
- **PoW Solve Time:** < 5ms average (match or beat Node.js)
- **Memory Usage:** < 100MB under normal load
- **Request Latency:** < 50ms overhead (excluding ChatGPT latency)

#### NFR2: Reliability
- **Uptime:** 99%+ (for personal use)
- **Token Refresh:** 100% success rate on valid session tokens
- **Tool Execution:** Graceful failures with clear error messages

#### NFR3: Resource Efficiency
- **Binary Size:** < 15MB
- **Build Time:** < 2 minutes (release build)
- **Concurrent Connections:** Support 3 simultaneous users comfortably

#### NFR4: Maintainability
- **Code Complexity:** Simple, readable Rust patterns
- **Dependencies:** Minimal, well-maintained crates only
- **Documentation:** Inline comments for complex logic

---

## Out of Scope

The following are explicitly **NOT** in scope for this version:

❌ **Databases:** No PostgreSQL, SQLite, or vector databases  
❌ **Multi-LLM Routing:** ChatGPT web proxy only, no OpenAI/Anthropic/Google APIs  
❌ **Production Features:** No metrics, rate limiting, API docs, health checks  
❌ **Multi-Tenancy:** Single user/session token only  
❌ **Authentication:** Optional simple API key only  
❌ **Scaling:** Designed for 1-3 users, not 100+  
❌ **Cross-Conversation Search:** No semantic search across threads  
❌ **Background Jobs:** No async job processing  

---

## User Stories

### US1: IDE Integration
**As a** developer using Cursor  
**I want** to connect to my ChatGPT proxy  
**So that** I can use ChatGPT web through Cursor's OpenAI integration

**Acceptance Criteria:**
- Set Cursor base URL to `http://localhost:3000/v1`
- Chat completions work in Cursor
- Streaming responses appear in real-time
- Tool calls execute and return results

---

### US2: Automatic Token Refresh
**As a** user running the proxy  
**I want** my access token to refresh automatically  
**So that** I don't get 401 errors after tokens expire

**Acceptance Criteria:**
- First request fetches access token from session token
- Expired tokens refresh automatically on 401
- No manual intervention required

---

### US3: Reliable Tool Calling
**As a** developer using tools in Cursor  
**I want** tool calls to be parsed reliably  
**So that** the model can execute filesystem/shell operations

**Acceptance Criteria:**
- Tool schemas defined clearly in prompt
- Model outputs structured JSON format
- Parser validates against schemas
- Tool execution results fed back to model

---

### US4: Thinking Model Support
**As a** user of o1/o3 models  
**I want** to see the model's reasoning process  
**So that** I understand how it arrived at answers

**Acceptance Criteria:**
- Reasoning content extracted from ChatGPT response
- Reasoning and content separated in OpenAI format
- Streaming shows reasoning first, then answer

---

### US5: Filesystem Tool
**As a** developer  
**I want** the model to read/write files  
**So that** it can help with code generation and editing

**Acceptance Criteria:**
- Model can read files in allowed directories
- Model can write/create files
- Security constraints prevent access outside allowed paths
- File size limits enforced

---

### US6: HTTP Tool
**As a** developer  
**I want** the model to make HTTP requests  
**So that** it can fetch data from APIs

**Acceptance Criteria:**
- Model can make GET/POST/PUT/DELETE requests
- Localhost and private IPs blocked
- Domain whitelist configurable
- Response size limits enforced

---

### US7: Shell Tool
**As a** developer  
**I want** the model to execute shell commands  
**So that** it can run build scripts and checks

**Acceptance Criteria:**
- Model can run whitelisted commands only
- Command timeout enforced (30s default)
- Output size limited (1MB default)
- Dangerous commands blocked

---

## Success Metrics

### Primary Metrics

1. **Reliability:** 0 token refresh failures over 1 week of usage
2. **Tool Success Rate:** > 95% tool executions succeed
3. **Performance:** < 100ms p95 proxy overhead
4. **Memory:** < 100MB steady-state memory usage

### Secondary Metrics

1. **Binary Size:** < 15MB release binary
2. **Build Time:** < 2 minutes release build
3. **Startup Time:** < 100ms cold start
4. **Error Rate:** < 1% request failures (excluding ChatGPT issues)

---

## Technical Constraints

### Must Use
- **Language:** Rust (1.75+)
- **Web Framework:** Axum
- **Async Runtime:** Tokio
- **HTTP Client:** Reqwest
- **Hashing:** SHA3 (PoW), SHA2 (conversation fingerprinting)

### Must Avoid
- Databases (PostgreSQL, SQLite, Redis)
- Actor frameworks (Actix actors, not Actix-web)
- Complex async primitives (channels, select!, etc. unless necessary)
- Heavy dependencies (large crates, many transitive deps)

### Environment
- **Deployment:** Render (Docker) or local binary
- **OS:** Linux (Debian/Ubuntu) or macOS
- **Resources:** 512MB RAM, 1 CPU core minimum

---

## Dependencies & Integration

### External Services
- **ChatGPT Web Backend:** `chatgpt.com/backend-api/conversation`
- **Authentication:** `chatgpt.com/api/auth/session`

### Client Integration
- **Cursor IDE:** OpenAI API integration
- **Continue (VS Code):** OpenAI provider
- **Kilo Code:** OpenAI-compatible provider
- **LobeChat:** OpenAI base URL override

### Dashboard
- **Existing TypeScript Dashboard:** Served as static files
- **No Changes Required:** Dashboard uses `/v1/*` API endpoints

---

## Risk Assessment

### High Risks

**Risk 1: ChatGPT API Changes**
- **Impact:** High - Could break the proxy entirely
- **Probability:** Medium - OpenAI changes APIs periodically
- **Mitigation:** Monitor ChatGPT web changes, maintain Node.js version as reference

**Risk 2: PoW Difficulty Increase**
- **Impact:** Medium - Could slow down requests significantly
- **Probability:** Low - Current difficulty has been stable
- **Mitigation:** Implement timeout, parallel solving if needed

### Medium Risks

**Risk 3: Tool Security**
- **Impact:** High - Could allow filesystem access outside bounds
- **Probability:** Low - Rust's safety + validation prevents most issues
- **Mitigation:** Comprehensive security testing, whitelist-based approach

**Risk 4: Memory Leaks**
- **Impact:** Medium - Long-running process could accumulate memory
- **Probability:** Low - Rust's ownership prevents most leaks
- **Mitigation:** Monitor memory usage, periodic restarts if needed

---

## Timeline & Milestones

### Phase 1: Core Proxy (2 weeks)
**Milestone:** Basic chat completions working
- Auth & token management
- PoW solver
- Conversation cache
- ChatGPT API client
- SSE streaming

### Phase 2: Tool System (1-2 weeks)
**Milestone:** Tools execute end-to-end
- Tool definition system
- Tool call parser
- Filesystem, HTTP, shell, code tools
- Tool execution integration

### Phase 3: Polish (1 week)
**Milestone:** Production-ready for personal use
- Dashboard integration
- Error handling
- Testing & bug fixes
- Documentation
- Deployment

**Total Timeline:** 3-4 weeks

---

## Approval

**Design Approved By:** Project Owner  
**Date:** 2026-07-16  
**Next Steps:** Create implementation plan and begin Phase 1 development

---

## Appendix

### Related Documents
- Technical Design: `docs/superpowers/specs/2026-07-16-rust-migration-design.md`
- Architecture: `docs/ARCHITECTURE.md`
- Phases: `docs/PHASES.md`
- Tasks: `docs/TASKS.md`
- Rules: `docs/RULES.md`

### References
- Chimera Project: `/Users/Utkarsh/Documents/chimera`
- Original Node.js Implementation: `/Users/Utkarsh/Documents/conduit`

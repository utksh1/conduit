# Implementation Phases & Milestones

**Project**: ChatGPT-to-API Rust Migration  
**Version**: 1.0  
**Last Updated**: 2026-07-16  
**Total Duration**: 3-4 weeks

---

## Overview

The implementation is divided into three phases, each with clear milestones and deliverables. Each phase builds on the previous one, allowing for incremental testing and validation.

```
Timeline:
├── Phase 1: Core Proxy (2 weeks)
│   └── Milestone: Basic chat completions working
├── Phase 2: Tool System (1-2 weeks)
│   └── Milestone: Tools execute end-to-end
└── Phase 3: Polish (1 week)
    └── Milestone: Production-ready for personal use
```

---

## Phase 1: Core Proxy (2 Weeks)

### Goal
Build the fundamental proxy functionality that translates OpenAI API requests to ChatGPT web backend calls.

### Deliverables

1. **Project Setup**
   - Cargo workspace initialized
   - Directory structure created
   - Dependencies configured
   - Development environment ready

2. **Configuration System**
   - Environment variable loading (.env)
   - Config struct with validation
   - Error handling for missing required config

3. **Authentication Manager**
   - Session token → access token exchange
   - Token caching with expiry tracking
   - Reactive refresh on 401 responses
   - Thread-safe token storage (Arc<RwLock>)

4. **Conversation Cache**
   - SHA-256 message fingerprinting
   - HashMap-based cache storage
   - Lookup and store operations
   - Thread-safe access (Arc<RwLock>)

5. **PoW Solver**
   - SHA3-512 brute force implementation
   - Leading zero bit counting
   - Configurable timeout (5s default)
   - Performance optimization

6. **ChatGPT HTTP Client**
   - Reqwest client with connection pooling
   - Request building (stateful/stateless)
   - Response parsing
   - Error handling and retries

7. **SSE Streaming**
   - Stream transformation (accumulated → delta)
   - OpenAI format encoding
   - Proper SSE formatting (data: ...\n\n)
   - Stream error handling

8. **HTTP Server**
   - Axum router setup
   - POST /v1/chat/completions endpoint
   - GET /v1/models endpoint
   - CORS middleware
   - Basic error responses

### Milestone Criteria

**Definition of Done:**

✅ Server starts and listens on configured port  
✅ Accepts OpenAI-format chat completion requests  
✅ Authenticates with ChatGPT backend using session token  
✅ Access token refreshes automatically on 401  
✅ Solves PoW challenges when required  
✅ Returns OpenAI-format responses (non-streaming)  
✅ Streams responses in SSE format (streaming)  
✅ Stateful conversation mapping works  
✅ Unit tests pass for core components  
✅ Manual test: Cursor can connect and send messages  

**Success Metrics:**
- Token refresh: 100% success rate
- PoW solve time: < 5ms average
- Proxy overhead: < 50ms p95
- Memory usage: < 50MB idle

### Testing Checklist

**Unit Tests:**
- [ ] Message hashing produces consistent results
- [ ] Token expiry detection works correctly
- [ ] PoW solver finds valid solutions
- [ ] Stream transformer computes deltas correctly

**Integration Tests:**
- [ ] Full request/response cycle completes
- [ ] Token refresh triggers on 401
- [ ] Conversation cache lookup works
- [ ] Streaming response formats correctly

**Manual Tests:**
- [ ] Cursor connects successfully
- [ ] Send simple chat message → receive response
- [ ] Streaming shows incremental chunks
- [ ] Multiple messages maintain conversation context

---

## Phase 2: Tool System (1-2 Weeks)

### Goal
Add Chimera-inspired tool execution system with structured schemas and security constraints.

### Deliverables

1. **Tool Definition System**
   - ToolDefinition struct (name, description, parameters)
   - JSON Schema support for parameters
   - Tool registry/catalog

2. **Tool Call Parser**
   - Extract JSON between TOOL_CALL_START/END markers
   - Parse tool_calls array
   - Validate against tool schemas
   - Clear error messages for invalid calls

3. **Tool Prompt Injection**
   - System prompt template with tool schemas
   - Delimiter-based format (TOOL_CALL_START/END)
   - Model upgrade for tool mode (optional thinking model)

4. **Security Configuration**
   - Filesystem: allowed directories, size limits
   - HTTP: blocked hosts, domain whitelist, size limits
   - Shell: command whitelist, timeout, output limits
   - Code: read-only constraints

5. **Filesystem Tool**
   - Operations: read, write, list, delete, mkdir, exists
   - Path validation and canonicalization
   - Size limit enforcement
   - Error handling

6. **HTTP Request Tool**
   - Methods: GET, POST, PUT, DELETE, PATCH
   - Localhost/private IP blocking
   - Domain whitelist checking
   - Response size limits
   - Timeout handling

7. **Shell Tool**
   - Command whitelist enforcement
   - Argument sanitization
   - Process spawning with timeout
   - Output capture and size limits
   - Error/exit code handling

8. **Code Analysis Tool**
   - Parse code structure
   - Basic linting
   - Read-only operations
   - Language detection

9. **Tool Executor**
   - Route calls to appropriate tools
   - Execute with security constraints
   - Capture results/errors
   - Format as OpenAI tool responses

10. **Tool Call Loop**
    - Parse tool calls from model response
    - Execute all tools
    - Format results as messages
    - Recursive call with tool results
    - Return final response

### Milestone Criteria

**Definition of Done:**

✅ Tool schemas defined and documented  
✅ Tool call parser extracts calls reliably  
✅ Security constraints enforced for all tools  
✅ Filesystem tool executes read/write/list operations  
✅ HTTP tool makes requests with validation  
✅ Shell tool executes whitelisted commands  
✅ Code tool parses and analyzes files  
✅ Tool results feed back into conversation  
✅ Errors handled gracefully (continue conversation)  
✅ Unit tests pass for all tools  
✅ Manual test: Tools work in Cursor  

**Success Metrics:**
- Tool execution success rate: > 95%
- Tool call parsing accuracy: > 99%
- Security violations: 0 (all blocked correctly)
- Average tool execution time: < 500ms

### Testing Checklist

**Unit Tests:**
- [ ] Tool call parser handles valid JSON
- [ ] Tool call parser rejects invalid JSON
- [ ] Schema validation catches malformed arguments
- [ ] Security constraints block unauthorized access
- [ ] Filesystem tool respects allowed directories
- [ ] HTTP tool blocks localhost/private IPs
- [ ] Shell tool rejects non-whitelisted commands

**Integration Tests:**
- [ ] Tool call → execute → result → continue conversation
- [ ] Multiple tool calls in sequence
- [ ] Tool errors don't crash the proxy
- [ ] Tool results format correctly for model

**Manual Tests:**
- [ ] Ask model to read a file → filesystem tool executes
- [ ] Ask model to make HTTP request → HTTP tool executes
- [ ] Ask model to run shell command → shell tool executes
- [ ] Ask model to analyze code → code tool executes
- [ ] Verify security blocks work (try restricted paths)

---

## Phase 3: Polish (1 Week)

### Goal
Integrate dashboard, improve error handling, test thoroughly, and prepare for deployment.

### Deliverables

1. **Dashboard Integration**
   - Build TypeScript dashboard (npm run build)
   - Configure static file serving in Axum
   - Test dashboard → API communication
   - Verify all dashboard features work

2. **Error Handling Improvements**
   - Comprehensive error types
   - IntoResponse implementation
   - Clear error messages for clients
   - Logging at appropriate levels

3. **Configuration Validation**
   - Required env vars checked at startup
   - Clear error messages for missing config
   - Default values documented
   - .env.example created

4. **Documentation**
   - README updated with Rust version
   - Setup instructions (build, run, deploy)
   - Client integration guides (Cursor, Continue, etc.)
   - Troubleshooting section
   - API documentation (inline)

5. **Testing**
   - Full test suite running
   - Integration test coverage
   - Manual testing checklist completed
   - Load testing (basic)

6. **Performance Optimization**
   - Profile hot paths
   - Optimize allocations if needed
   - Release build configured
   - Binary size checked

7. **Deployment Preparation**
   - Dockerfile created
   - Docker build tested
   - Render configuration (render.yaml)
   - Environment variable documentation

8. **Bug Fixes**
   - Fix issues found during testing
   - Handle edge cases
   - Improve error messages
   - Performance tuning

### Milestone Criteria

**Definition of Done:**

✅ Dashboard loads and connects to API  
✅ All dashboard features functional  
✅ Error messages are clear and actionable  
✅ README is complete and accurate  
✅ All tests pass (unit + integration)  
✅ Manual testing checklist completed  
✅ Docker build succeeds  
✅ Render deployment works  
✅ Memory usage < 100MB under load  
✅ Binary size < 15MB  
✅ No known critical bugs  

**Success Metrics:**
- Test coverage: > 80% for critical paths
- Build time: < 2 minutes (release)
- Startup time: < 100ms
- Memory usage: < 100MB steady state
- Binary size: < 15MB

### Testing Checklist

**Comprehensive Manual Testing:**
- [ ] Connect Cursor and run various prompts
- [ ] Test streaming responses
- [ ] Test all tool types (filesystem, HTTP, shell, code)
- [ ] Test thinking models (o1, o3, gpt-5-5-thinking)
- [ ] Verify token refresh works (wait for expiry)
- [ ] Test error scenarios (invalid token, network failure)
- [ ] Test dashboard UI (all features)
- [ ] Check memory usage over 1-hour session
- [ ] Verify clean shutdown (Ctrl+C)

**Deployment Testing:**
- [ ] Build Docker image
- [ ] Run Docker container
- [ ] Deploy to Render
- [ ] Test from external client
- [ ] Check Render logs
- [ ] Verify environment variables work

**Performance Testing:**
- [ ] Measure startup time
- [ ] Measure request latency (50 requests)
- [ ] Check memory usage (10 concurrent conversations)
- [ ] Profile PoW solve time
- [ ] Check binary size

---

## Phase Transitions

### Phase 1 → Phase 2

**Before starting Phase 2:**
1. All Phase 1 milestone criteria met
2. Cursor can send messages and receive responses
3. Token refresh verified working
4. No critical bugs in core proxy

**Transition Tasks:**
- Git tag: `phase-1-complete`
- Update TASKS.md with Phase 1 completion
- Review Phase 2 requirements
- Plan tool implementation order

---

### Phase 2 → Phase 3

**Before starting Phase 3:**
1. All Phase 2 milestone criteria met
2. All 4 tools execute successfully
3. Tool call loop works end-to-end
4. Security constraints verified
5. No critical bugs in tool system

**Transition Tasks:**
- Git tag: `phase-2-complete`
- Update TASKS.md with Phase 2 completion
- Review Phase 3 requirements
- Prepare dashboard build environment

---

### Phase 3 → Release

**Before releasing v1.0:**
1. All Phase 3 milestone criteria met
2. All tests passing
3. Documentation complete
4. Deployment verified on Render
5. Manual testing checklist complete
6. No known critical bugs

**Release Tasks:**
- Git tag: `v1.0.0`
- Update TASKS.md (all complete)
- Create GitHub release (if applicable)
- Deploy to production (Render)
- Announce completion

---

## Risk Mitigation

### Phase 1 Risks

**Risk:** ChatGPT API changes break proxy  
**Mitigation:** Reference Node.js implementation, monitor for errors

**Risk:** PoW difficulty increases significantly  
**Mitigation:** Implement timeout, consider parallel solving

**Risk:** Token refresh logic fails  
**Mitigation:** Comprehensive testing, retry logic, clear errors

### Phase 2 Risks

**Risk:** Tool security bypassed  
**Mitigation:** Whitelist approach, comprehensive testing, code review

**Risk:** Tool execution hangs/crashes  
**Mitigation:** Timeouts, error handling, process isolation

**Risk:** Model doesn't follow tool format  
**Mitigation:** Clear prompts, validation, error messages back to model

### Phase 3 Risks

**Risk:** Dashboard doesn't work with Rust backend  
**Mitigation:** Keep API compatible, test thoroughly

**Risk:** Performance issues under load  
**Mitigation:** Profiling, optimization, load testing

**Risk:** Deployment issues on Render  
**Mitigation:** Docker testing, environment variable documentation

---

## Success Criteria (Overall)

### Functional Success
- ✅ All OpenAI API endpoints implemented
- ✅ ChatGPT web proxy working reliably
- ✅ Tool execution system functional
- ✅ Dashboard integrated and working
- ✅ Deployed to Render successfully

### Quality Success
- ✅ Test coverage > 80% for critical paths
- ✅ No critical bugs
- ✅ Clear error messages
- ✅ Documentation complete

### Performance Success
- ✅ Startup time < 100ms
- ✅ Memory usage < 100MB
- ✅ Binary size < 15MB
- ✅ Proxy overhead < 50ms p95

### User Success
- ✅ Works with Cursor/Continue/Kilo Code
- ✅ Token refresh automatic
- ✅ Tools execute reliably
- ✅ Thinking models work correctly

---

## Related Documents

- **PRD:** `docs/PRD.md` - Product requirements
- **Architecture:** `docs/ARCHITECTURE.md` - Technical design
- **Tasks:** `docs/TASKS.md` - Detailed task tracking
- **Rules:** `docs/RULES.md` - Development conventions
- **Design Spec:** `docs/superpowers/specs/2026-07-16-rust-migration-design.md`

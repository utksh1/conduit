# Testing Strategy

**Project**: ChatGPT-to-API Rust Migration  
**Version**: 1.0  
**Last Updated**: 2026-07-16

---

## Purpose

This document defines the tests required to complete each migration milestone. It complements:

- `docs/PHASES.md` for delivery milestones
- `docs/TASKS.md` for implementation tracking
- `docs/RULES.md` for code-quality and security requirements
- `docs/ARCHITECTURE.md` for component contracts

The proxy depends on an unofficial, externally controlled ChatGPT web backend. Tests must therefore separate deterministic local behavior from live-account verification:

1. **Unit tests** validate pure logic and component behavior without network access.
2. **Integration tests** validate module boundaries against local mock servers.
3. **Manual smoke tests** validate the real ChatGPT account and client integrations.

Never place a real `CHATGPT_SESSION_TOKEN`, access token, API key, or raw cookie in source code, snapshots, test fixtures, CI logs, or documentation examples.

---

## Test Pyramid

```
                 Manual smoke tests
              Live account / Cursor / Render

            Integration tests with mocks
      Axum routes, reqwest client, SSE, tool loop

                  Unit tests
 Hashing, expiry, PoW, parsing, validation, security
```

Most behavior belongs in unit tests. Integration tests cover contracts between components. Manual checks are deliberately small, credentialed, and run only before a phase is accepted or deployed.

### Test Categories

| Category | Location | Network | Purpose |
| --- | --- | --- | --- |
| Unit | next to the module under `src/` | No | Fast deterministic logic tests |
| Integration | `tests/` | Local mocks only | Route, client, streaming, and tool-loop contracts |
| Manual smoke | checklist in this document | Real upstream | Confirm current ChatGPT and client compatibility |
| Performance | `tests/` or benchmark scripts | Local mocks | Guard latency, memory, and binary-size targets |

### Commands

Run these commands during development and before each milestone sign-off:

```bash
cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all-features
cargo test --all-features --test integration
cargo build --release
```

Optional coverage command, once coverage tooling is installed:

```bash
cargo llvm-cov --all-features --workspace --lcov --output-path lcov.info
```

Run live smoke tests only with environment variables supplied locally or through the deployment platform. They must not be required for `cargo test`.

---

## Test Infrastructure

### Fixture Rules

- Use synthetic session tokens such as `test-session-token`; never use a valid token.
- Use fixed timestamps, UUIDs, PoW seeds, and mock response bodies where output would otherwise vary.
- Keep fixtures minimal and focused on a single behavior.
- Store upstream event samples under `tests/fixtures/` after redacting identifiers, tokens, cookies, conversation IDs, and user content.
- Test tool execution inside temporary directories and local mock servers only.
- Test blocked-host logic with URL strings and resolver seams; never make requests to private network addresses.

### Mocks and Test Doubles

The implementation should make these boundaries injectable:

| Dependency | Test Double |
| --- | --- |
| Clock | Fixed or controllable clock |
| ChatGPT HTTP transport | Mock reqwest-compatible local server or transport trait |
| Token refresh endpoint | Local mock server returning success, 401, and malformed responses |
| SSE upstream stream | In-memory stream of fixture events |
| Tool registry | Small registry containing only the test tools |
| Filesystem | Temporary directory created by `tempfile` |
| Shell process | Explicitly allowed harmless commands or a process-runner trait |
| HTTP tool target | Local mock HTTP server |

Avoid global mutable state. Every test must create its own app state, cache, temporary directory, and mock server.

### Suggested Dev Dependencies

```toml
[dev-dependencies]
assert_matches = "1"
axum-test = "17"
http-body-util = "0.1"
serial_test = "3"
tempfile = "3"
tokio-stream = "0.1"
tower = "0.5"
wiremock = "0.6"
```

Use only dependencies that fit the implemented interfaces. `wiremock` is appropriate for HTTP contract tests; do not use it to hide parsing or business-logic tests that should be unit tests.

---

## Coverage Targets

Coverage is a quality signal, not a replacement for meaningful assertions.

| Area | Minimum target | Required focus |
| --- | ---: | --- |
| Message fingerprinting | 100% | Determinism and collision-relevant fields |
| PoW solver and zero-bit counting | 100% | Validity, boundaries, timeout behavior |
| SSE delta transformer | 100% | Accumulation, reset, finish, malformed events |
| Tool-call parser | 90%+ | Valid, invalid, partial, duplicate delimiters |
| Security validation | 100% | Allowed and denied paths, hosts, commands, limits |
| Authentication manager | 80%+ | Cached use, reactive 401 refresh, single retry |
| HTTP handlers | 80%+ | Validation, response mapping, error responses |
| Tool implementations | 80%+ | Happy path and all enforcement boundaries |

A milestone cannot pass with untested security denial paths, even where aggregate coverage meets its target.

---

# Phase 1: Core Proxy

## Milestone 1.1: Project and Configuration

### Unit Tests

- [ ] A complete valid environment produces a valid `Config`.
- [ ] Missing `CHATGPT_SESSION_TOKEN` fails startup with an actionable error.
- [ ] Optional `PROXY_API_KEY` is absent when unset and available when configured.
- [ ] Default model, port, timeouts, and limits use documented defaults.
- [ ] Invalid numeric environment values fail validation instead of silently falling back.
- [ ] Session-token values never appear in `Debug` or `Display` output.

### Integration Tests

- [ ] App construction succeeds with a test-only configuration.
- [ ] Startup failures return before binding a listener when required configuration is invalid.

### Exit Gate

- [ ] `cargo test config` passes.
- [ ] A local process starts using a synthetic `.env` file.
- [ ] Missing configuration produces a clear startup error without printing secrets.

## Milestone 1.2: Conversation Mapping

### Unit Tests

- [ ] Identical message prefixes produce the same SHA-256 fingerprint.
- [ ] Changing role, name, content, tool-call data, or tool output changes the fingerprint.
- [ ] The hash format is stable and has the expected hexadecimal length.
- [ ] An empty message list has deterministic behavior.
- [ ] Cache `store` followed by `lookup` returns the expected conversation context.
- [ ] An unknown key is a cache miss.
- [ ] Replacing an existing key updates its context.
- [ ] Concurrent reads and writes do not panic or corrupt entries.

### Integration Tests

- [ ] Two matching requests use the stored `conversation_id` and `parent_message_id`.
- [ ] A changed prefix causes a stateless/new-conversation request.

### Exit Gate

- [ ] Fingerprint and cache tests pass repeatedly under `-- --test-threads=1` and default parallel execution.
- [ ] Request payload assertions prove the stateful and cache-miss paths are distinct.

## Milestone 1.3: Authentication and Reactive Refresh

### Unit Tests

- [ ] A valid cached access token is returned without a refresh request.
- [ ] A missing token triggers a session-token exchange.
- [ ] An expired token triggers a refresh before use.
- [ ] Expiry boundary behavior is deterministic using a fixed clock.
- [ ] A 401 from the upstream request invalidates the cached token.
- [ ] The failed request is retried exactly once after a successful refresh.
- [ ] A second 401 is returned as an authentication/upstream error, not retried forever.
- [ ] Concurrent callers share a single in-flight refresh and receive the refreshed token.
- [ ] Refresh failure leaves no invalid token marked as valid.
- [ ] Errors and logs redact session and access tokens.

### Integration Tests

- [ ] Mock refresh endpoint returns a token and the subsequent upstream request has its bearer token.
- [ ] Mock upstream returns 401, then 200; verify one refresh and two upstream attempts.
- [ ] Mock upstream returns 401 twice; verify one refresh and a mapped failure response.
- [ ] Multiple simultaneous route requests cause one refresh exchange.

### Exit Gate

- [ ] All reactive refresh scenarios pass against a local mock server.
- [ ] No background token-refresh task is created or required.

## Milestone 1.4: Sentinel Proof of Work

### Unit Tests

- [ ] Leading-zero-bit counting handles zero bytes, partial-byte boundaries, and nonzero first bits.
- [ ] A known valid nonce verifies successfully.
- [ ] A known invalid nonce fails verification.
- [ ] Difficulty zero returns a valid result immediately.
- [ ] Solved proof meets the required difficulty.
- [ ] Timeout returns a typed timeout error.
- [ ] Invalid or malformed challenge input returns a typed validation error.
- [ ] Every candidate attempt creates a fresh `Sha3_512` hasher before hashing.

### Integration Tests

- [ ] A mock protected endpoint accepts the generated PoW header/payload.
- [ ] A deterministic low-difficulty challenge completes within the configured test timeout.

### Exit Gate

- [ ] PoW module coverage is 100%.
- [ ] Tests validate proof correctness, not a specific nondeterministic nonce.
- [ ] Production benchmark records average solve time against a representative low-difficulty fixture.

## Milestone 1.5: ChatGPT Client and Non-Streaming API

### Unit Tests

- [ ] OpenAI requests map to the expected upstream stateful payload.
- [ ] Requests without cache state map to the expected stateless payload.
- [ ] Required headers, model selection, parent message ID, and conversation ID are encoded correctly.
- [ ] Upstream 4xx, 5xx, malformed JSON, and timeout errors map to typed domain errors.
- [ ] Retry policy only retries the permitted reactive-refresh path.
- [ ] Thinking/reasoning content is retained and mapped according to the response contract.

### Integration Tests

- [ ] `POST /v1/chat/completions` returns an OpenAI-compatible non-streaming JSON response.
- [ ] Invalid request bodies return `400` and valid OpenAI error JSON.
- [ ] Missing or invalid proxy API key returns `401` when proxy authentication is enabled.
- [ ] `GET /v1/models` returns configured/supported models.
- [ ] CORS preflight receives expected headers.

### Exit Gate

- [ ] A mocked end-to-end non-streaming request completes.
- [ ] Tests assert client-facing JSON shape, not only status codes.

## Milestone 1.6: SSE Streaming

### Unit Tests

- [ ] First accumulated upstream content becomes the first delta.
- [ ] Later accumulated content emits only the new suffix.
- [ ] Empty accumulated updates emit no duplicate content.
- [ ] A new message ID resets delta tracking correctly.
- [ ] Reasoning content and visible content are transformed independently where required.
- [ ] Finish reasons produce one terminal chunk.
- [ ] The stream ends with `data: [DONE]\n\n` exactly once.
- [ ] Malformed upstream events produce a stream error or skip behavior defined by the contract.

### Integration Tests

- [ ] Mock upstream SSE becomes valid OpenAI SSE chunks with `content-type: text/event-stream`.
- [ ] Concatenating received deltas recreates the expected final content.
- [ ] Upstream termination produces a terminal chunk and closes the response.
- [ ] Mid-stream upstream error produces the documented OpenAI-compatible error behavior.

### Manual Smoke Checklist: Phase 1

- [ ] Start the proxy using a real session token loaded only from local environment configuration.
- [ ] Send a non-streaming message through the dashboard or `curl` and receive a valid completion.
- [ ] Send a streaming message and observe incremental content followed by `[DONE]`.
- [ ] Send a second message in the same conversation and confirm the model retains prior context.
- [ ] Connect Cursor, Continue, or Kilo Code and complete one short chat request.
- [ ] Force an expired access token or wait for natural expiry; confirm the next request refreshes once and succeeds.
- [ ] Inspect logs and confirm they contain neither session nor access tokens.

### Phase 1 Acceptance Gate

- [ ] All Phase 1 unit and integration tests pass.
- [ ] Phase 1 manual smoke checklist is complete.
- [ ] `cargo clippy --all-targets --all-features -- -D warnings` passes.
- [ ] No known authentication, context, or stream corruption bug remains.
- [ ] Tag the accepted revision as `phase-1-complete` and update `docs/TASKS.md`.

---

# Phase 2: Tool System

## Milestone 2.1: Tool Definitions, Prompt, and Parser

### Unit Tests

- [ ] Every registered tool has a nonempty unique name, description, and JSON Schema.
- [ ] Tool schemas serialize into the prompt template deterministically.
- [ ] Prompt assembly includes the `TOOL_CALL_START` and `TOOL_CALL_END` protocol instructions.
- [ ] Parser extracts one valid JSON tool-call block.
- [ ] Parser extracts multiple calls in one `tool_calls` array.
- [ ] Text before and after a delimiter block is preserved as assistant content when required.
- [ ] Missing start marker, missing end marker, empty block, and duplicate blocks follow documented behavior.
- [ ] Invalid JSON returns a typed parser error without panic.
- [ ] JSON with unknown tool names is rejected before execution.
- [ ] Schema validation rejects missing fields, wrong types, unknown fields when disallowed, and invalid enums.
- [ ] Valid structured calls receive stable generated call IDs when the model does not provide one.

### Integration Tests

- [ ] A mocked model response with a delimiter block becomes OpenAI-format `tool_calls`.
- [ ] An invalid call becomes a recoverable tool-result/error message, not a server crash.

### Exit Gate

- [ ] Parser coverage is at least 90%.
- [ ] Fixture corpus includes valid, invalid, partial, and multi-call outputs.

## Milestone 2.2: Security Configuration

### Unit Tests

- [ ] Empty allowlists deny filesystem paths, domains, and commands by default.
- [ ] Path canonicalization blocks `..` traversal and symlink escape attempts.
- [ ] Allowed child paths remain allowed after canonicalization.
- [ ] File and output size limits reject oversized content before excessive allocation.
- [ ] HTTP policy blocks `localhost`, loopback, link-local, RFC1918, and unspecified addresses.
- [ ] Domain matching distinguishes exact hosts from lookalike suffixes.
- [ ] Shell policy permits only explicitly configured executable names.
- [ ] Shell arguments containing separators or unsupported syntax are rejected according to policy.
- [ ] Every timeout and output limit returns a clear typed error.

### Integration Tests

- [ ] Configuration reaches each executor and is enforced there, not only at route entry.
- [ ] Denied operations return structured tool errors that can be sent back to the model.

### Exit Gate

- [ ] Security-denial paths have 100% coverage.
- [ ] All known restricted paths, hosts, and commands are rejected by tests.

## Milestone 2.3: Filesystem Tool

### Unit Tests

- [ ] `read` returns UTF-8 content from an allowed temporary directory.
- [ ] `list` returns expected entries without escaping the allowed directory.
- [ ] `write` creates or overwrites only permitted files.
- [ ] `mkdir` creates allowed nested paths.
- [ ] `exists` reports both present and absent files.
- [ ] `delete` obeys the configured policy and never accepts traversal paths.
- [ ] Reads and writes reject files beyond configured size limits.
- [ ] Binary/non-UTF-8 and missing-path errors are explicit and do not panic.

### Integration Tests

- [ ] Parsed filesystem call executes against a `tempfile` directory and returns an OpenAI tool message.
- [ ] A denied path returns a tool error while the request loop remains usable.

## Milestone 2.4: HTTP Tool

### Unit Tests

- [ ] Allowed GET request maps method, headers, and body correctly.
- [ ] POST, PUT, PATCH, and DELETE requests use the requested supported method.
- [ ] Blocked local/private hosts fail before making a network request.
- [ ] Domain allowlist denial fails before making a network request.
- [ ] Redirects are revalidated at each destination.
- [ ] Response-body limits stop oversized responses.
- [ ] Timeout and non-2xx responses map to structured tool results.

### Integration Tests

- [ ] Allowed request completes against a local mock server only when the test policy explicitly allows its test host.
- [ ] Redirect to a forbidden host is rejected.
- [ ] HTTP result body, status, and truncated-output metadata are formatted correctly.

## Milestone 2.5: Shell Tool

### Unit Tests

- [ ] Allowed command with permitted arguments returns captured stdout and exit code.
- [ ] Non-whitelisted executable is rejected before spawning.
- [ ] Disallowed arguments are rejected before spawning.
- [ ] Nonzero exit status is reported as a tool result rather than crashing the proxy.
- [ ] Timeout kills or terminates the child process and returns a timeout error.
- [ ] Output truncation is explicit and does not exceed its limit.
- [ ] Working directory is constrained to the configured allowed directory.

### Integration Tests

- [ ] Parser-to-executor flow runs a harmless whitelisted command in a temporary directory.
- [ ] A timed-out command leaves no child process running.

## Milestone 2.6: Code Analysis Tool

### Unit Tests

- [ ] Language detection handles supported file extensions and unknown extensions.
- [ ] Parser returns top-level structural information for valid sample files.
- [ ] Invalid syntax produces a diagnostic without panic.
- [ ] Read-only policy rejects mutating operations.
- [ ] Analysis output respects configured input and output limits.

### Integration Tests

- [ ] A tool call analyzes a fixture source file and returns a structured result.
- [ ] Disallowed path and unsupported language return recoverable tool errors.

## Milestone 2.7: Executor and Tool Loop

### Unit Tests

- [ ] Executor routes a known tool name to its implementation.
- [ ] Unknown tools return a structured error.
- [ ] Multiple calls execute in the documented order or concurrency model.
- [ ] One failed call does not prevent independent calls from receiving results.
- [ ] Tool output is formatted as a valid model/tool-result message.
- [ ] Recursion/call-loop limit prevents unbounded model-tool cycles.

### Integration Tests

- [ ] Model response -> parser -> filesystem tool -> tool-result message -> follow-up model response returns a final completion.
- [ ] Multiple calls in one model response complete and feed all results back.
- [ ] Invalid arguments and denied security operations produce model-visible errors but keep the HTTP request valid.
- [ ] Streaming tool-call response follows the documented stream behavior.

### Manual Smoke Checklist: Phase 2

- [ ] Ask the connected client to read a file in an allowed test directory.
- [ ] Ask it to list and write a harmless test file in that directory.
- [ ] Ask it to fetch an allowed public test URL or deployment-owned endpoint.
- [ ] Ask it to run one harmless whitelisted shell command.
- [ ] Ask it to analyze a fixture source file.
- [ ] Attempt a parent-directory filesystem path and confirm it is blocked.
- [ ] Attempt an unlisted command and confirm it is blocked.
- [ ] Attempt a localhost/private HTTP destination and confirm it is blocked.
- [ ] Confirm a tool error returns control to the model and does not crash the proxy.

### Phase 2 Acceptance Gate

- [ ] All tool unit and integration tests pass.
- [ ] Parser accuracy fixture suite passes with no false execution.
- [ ] Every allowlist, size limit, timeout, and denial path is tested.
- [ ] Phase 2 manual smoke checklist is complete.
- [ ] Tag the accepted revision as `phase-2-complete` and update `docs/TASKS.md`.

---

# Phase 3: Polish and Release

## Milestone 3.1: Dashboard and Error Contracts

### Automated Tests

- [ ] Dashboard build succeeds using its documented package command.
- [ ] Axum serves the built dashboard assets and fallback route.
- [ ] Dashboard API request uses the same OpenAI-compatible contract as external clients.
- [ ] Each public error type produces a stable status code and OpenAI-compatible error body.
- [ ] Invalid JSON, missing authentication, upstream failure, timeout, and tool failure responses do not leak internal details or secrets.

### Manual Checks

- [ ] Dashboard loads from the Rust server.
- [ ] Dashboard can send non-streaming and streaming requests.
- [ ] Model selection, errors, and latency display behave correctly.

## Milestone 3.2: Reliability and Performance

### Automated Tests

- [ ] Graceful shutdown stops accepting requests and completes/cancels streams predictably.
- [ ] Ten concurrent mocked conversations complete without deadlock or cache corruption.
- [ ] A bounded request burst records proxy overhead against a local mock upstream.
- [ ] Release binary size is measured and compared with the 15 MB target.
- [ ] Idle and bounded-load memory are measured with a documented local command or profiler.

### Manual Checks

- [ ] Run a 1-hour normal-use session and observe memory for unbounded growth.
- [ ] Test network loss, upstream timeout, invalid session token, and expired access token.
- [ ] Verify Ctrl+C clean shutdown and restart.

## Milestone 3.3: Docker and Render

### Automated Tests

- [ ] Docker image builds from a clean checkout.
- [ ] Container starts with synthetic required configuration and exposes health/API routes.
- [ ] Image does not contain `.env`, session token fixtures, or build-only secrets.
- [ ] `render.yaml` syntax and service commands match the release binary.

### Manual Deployment Checks

- [ ] Deploy the accepted image to Render with environment variables set in Render, not committed files.
- [ ] Send one external non-streaming request and one streaming request.
- [ ] Verify dashboard loading if enabled.
- [ ] Inspect Render logs for startup errors, token leakage, and unhandled failures.
- [ ] Verify a reactive token refresh after an upstream 401.

### Phase 3 Release Gate

- [ ] Full unit and integration suite passes in a clean environment.
- [ ] Critical-path coverage targets are met.
- [ ] Docker build and local container smoke test pass.
- [ ] Render deployment smoke checklist is complete.
- [ ] No known critical bugs remain.
- [ ] Update `README.md`, `docs/TASKS.md`, and release notes before tagging `v1.0.0`.

---

## Failure Triage

When a test fails, classify it before changing production code:

| Failure type | First action |
| --- | --- |
| Unit test | Check implementation logic and test input assumptions |
| Mock integration test | Check the contract between modules and fixture fidelity |
| Live smoke test only | Compare sanitized upstream response shape with fixtures; investigate upstream changes |
| Flaky timing test | Remove wall-clock dependence, use explicit timeout bounds, and isolate shared state |
| Security test | Treat as release-blocking until the denial path is restored and regression-tested |

For every production bug, add a focused regression test before or with the fix. Do not weaken an assertion merely to make the suite pass.

---

## Completion Record Template

Add an entry to `docs/TASKS.md` at each accepted milestone:

```markdown
### YYYY-MM-DD - Phase N Milestone Accepted

- Automated checks: `cargo fmt --all -- --check`, `cargo clippy --all-targets --all-features -- -D warnings`, `cargo test --all-features`
- Coverage: critical-path targets met
- Manual smoke checks: completed
- Known exceptions: none / list with owner and follow-up task
- Tag: `phase-N-complete`
```

---

## Related Documents

- `docs/PRD.md`
- `docs/ARCHITECTURE.md`
- `docs/PHASES.md`
- `docs/TASKS.md`
- `docs/RULES.md`

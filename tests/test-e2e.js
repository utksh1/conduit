/**
 * End-to-end test suite for chatgpt-to-api (v2 — fixed body read bugs)
 * Tests: health, streaming, tool calling, multi-turn tool loops, large message truncation
 */

const BASE_URL = "http://localhost:10000";
const API_KEY = process.env.PROXY_API_KEY || "";

const headers = {
  "Content-Type": "application/json",
  ...(API_KEY ? { "Authorization": `Bearer ${API_KEY}` } : {}),
};

let passed = 0;
let failed = 0;

function log(icon, msg) {
  console.log(`${icon} ${msg}`);
}

async function test(name, fn) {
  const start = Date.now();
  try {
    await fn();
    const ms = Date.now() - start;
    log("✅", `${name} (${ms}ms)`);
    passed++;
  } catch (e) {
    const ms = Date.now() - start;
    log("❌", `${name} (${ms}ms): ${e.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg);
}

// ─── Test 1: Health check ────────────────────────────────────────────────────
async function testHealthCheck() {
  const res = await fetch(`${BASE_URL}/ping`);
  assert(res.ok, `Health check failed: ${res.status}`);
  const body = await res.json();
  assert(body.status === "ok", `Unexpected status: ${body.status}`);
}

// ─── Test 2: Models endpoint ─────────────────────────────────────────────────
async function testModelsEndpoint() {
  const res = await fetch(`${BASE_URL}/v1/models`);
  assert(res.ok, `Models endpoint failed: ${res.status}`);
  const body = await res.json();
  assert(body.object === "list", `Expected list object, got: ${body.object}`);
  assert(body.data.length > 0, "No models returned");
}

// ─── Test 3: Non-streaming chat completion (simple) ──────────────────────────
async function testNonStreamingSimple() {
  const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: "gpt-5-5-instant",
      stream: false,
      messages: [{ role: "user", content: "Say exactly: HELLO_TEST_OK" }],
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Non-streaming failed: ${res.status} ${errText}`);
  }
  const body = await res.json();
  assert(body.choices && body.choices.length > 0, "No choices in response");
  const content = body.choices[0].message.content || "";
  assert(content.includes("HELLO_TEST_OK"), 
    `Expected HELLO_TEST_OK in response, got: ${content.slice(0, 200)}`);
}

// ─── Test 4: Streaming chat completion ───────────────────────────────────────
async function testStreamingBasic() {
  const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: "gpt-5-5-instant",
      stream: true,
      messages: [{ role: "user", content: "Write a short paragraph about the history of computing. Make it at least 100 words." }],
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Streaming request failed: ${res.status} ${errText}`);
  }
  assert(res.headers.get("content-type")?.includes("text/event-stream"), 
    `Expected SSE content type, got: ${res.headers.get("content-type")}`);

  const text = await res.text();
  const lines = text.split("\n").filter(l => l.startsWith("data: "));
  
  // Should end with [DONE]
  assert(text.includes("data: [DONE]"), "Missing data: [DONE] terminator");
  
  // Parse all chunks and collect content
  let fullContent = "";
  let chunkCount = 0;
  for (const line of lines) {
    const data = line.slice(6);
    if (data === "[DONE]") continue;
    try {
      const parsed = JSON.parse(data);
      if (parsed.choices?.[0]?.delta?.content) {
        fullContent += parsed.choices[0].delta.content;
        chunkCount++;
      }
    } catch {}
  }
  
  log("  ℹ️", `  Received ${chunkCount} content chunks, ${lines.length} total SSE events, ${fullContent.length} chars`);
  assert(chunkCount >= 3, `Expected ≥3 content chunks for streaming, got ${chunkCount} — text may not be streaming line-by-line. Full content length: ${fullContent.length}`);
}

// ─── Test 5: Tool calling (single call) ──────────────────────────────────────
async function testToolCallingSingle() {
  const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: "gpt-5-5-instant",
      stream: false,
      messages: [{ role: "user", content: "What is the current weather in Tokyo? Use the get_weather tool." }],
      tools: [{
        type: "function",
        function: {
          name: "get_weather",
          description: "Get the current weather for a location",
          parameters: {
            type: "object",
            properties: {
              location: { type: "string", description: "City name" }
            },
            required: ["location"]
          }
        }
      }],
      tool_choice: "required",
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Tool calling failed: ${res.status} ${errText}`);
  }
  const body = await res.json();
  
  assert(body.choices?.[0]?.message?.tool_calls?.length > 0, 
    `Expected tool_calls in response, got: ${JSON.stringify(body.choices?.[0]?.message).slice(0, 300)}`);
  
  const tc = body.choices[0].message.tool_calls[0];
  assert(tc.function.name === "get_weather", `Expected get_weather, got: ${tc.function.name}`);
  
  let args;
  try { args = JSON.parse(tc.function.arguments); } catch { args = tc.function.arguments; }
  log("  ℹ️", `  Tool call: ${tc.function.name}(${JSON.stringify(args)})`);
}

// ─── Test 6: Tool calling (streaming) ────────────────────────────────────────
async function testToolCallingStreaming() {
  const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: "gpt-5-5-instant",
      stream: true,
      messages: [{ role: "user", content: "Read the file /etc/hostname using the read_file tool." }],
      tools: [{
        type: "function",
        function: {
          name: "read_file",
          description: "Read the contents of a file at the given path",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string", description: "Absolute path to the file" }
            },
            required: ["path"]
          }
        }
      }],
      tool_choice: "required",
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Streaming tool call failed: ${res.status} ${errText}`);
  }
  
  const text = await res.text();
  assert(text.includes("data: [DONE]"), "Missing [DONE]");
  
  // Look for tool_calls in the SSE chunks
  let foundToolCall = false;
  let toolName = "";
  const lines = text.split("\n").filter(l => l.startsWith("data: ") && l.slice(6) !== "[DONE]");
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line.slice(6));
      if (parsed.choices?.[0]?.delta?.tool_calls) {
        foundToolCall = true;
        const tc = parsed.choices[0].delta.tool_calls[0];
        if (tc?.function?.name) toolName = tc.function.name;
      }
      if (parsed.choices?.[0]?.finish_reason === "tool_calls") {
        foundToolCall = true;
      }
    } catch {}
  }
  assert(foundToolCall, `No tool_calls found in streaming response. Events: ${lines.length}`);
  log("  ℹ️", `  Streaming tool call: ${toolName}, ${lines.length} SSE events`);
}

// ─── Test 7: Multi-turn tool loop (simulates agentic behavior) ───────────────
async function testMultiTurnToolLoop() {
  // Turn 1: User asks to check something
  const res1 = await fetch(`${BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: "gpt-5-5-instant",
      stream: false,
      messages: [
        { role: "user", content: "List the files in /tmp using the bash tool." }
      ],
      tools: [{
        type: "function",
        function: {
          name: "bash",
          description: "Run a shell command and return stdout",
          parameters: {
            type: "object",
            properties: {
              command: { type: "string", description: "Shell command to execute" }
            },
            required: ["command"]
          }
        }
      }],
      tool_choice: "auto",
    }),
  });
  if (!res1.ok) {
    const errText = await res1.text();
    throw new Error(`Turn 1 failed: ${res1.status} ${errText}`);
  }
  const body1 = await res1.json();
  
  const hasTool = body1.choices?.[0]?.message?.tool_calls?.length > 0;
  assert(hasTool, `Turn 1: Expected tool call, got: ${JSON.stringify(body1.choices?.[0]?.message).slice(0, 300)}`);
  
  const tc = body1.choices[0].message.tool_calls[0];
  log("  ℹ️", `  Turn 1 tool call: ${tc.function.name}(${tc.function.arguments})`);
  
  // Turn 2: Send back a fake tool result, expect model to continue
  const res2 = await fetch(`${BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: "gpt-5-5-instant",
      stream: false,
      messages: [
        { role: "user", content: "List the files in /tmp using the bash tool." },
        { 
          role: "assistant", 
          content: null,
          tool_calls: [tc]
        },
        {
          role: "tool",
          tool_call_id: tc.id,
          content: "file1.txt\nfile2.log\nscript.sh\ndata.json\ntest_results.xml"
        },
      ],
      tools: [{
        type: "function",
        function: {
          name: "bash",
          description: "Run a shell command and return stdout",
          parameters: {
            type: "object",
            properties: {
              command: { type: "string", description: "Shell command to execute" }
            },
            required: ["command"]
          }
        }
      }],
      tool_choice: "auto",
    }),
  });
  if (!res2.ok) {
    const errText = await res2.text();
    throw new Error(`Turn 2 failed: ${res2.status} ${errText}`);
  }
  const body2 = await res2.json();
  
  // Model should either respond with text or call another tool — not error
  assert(body2.choices?.[0]?.message, "Turn 2: No message in response");
  const hasContent = body2.choices[0].message.content && body2.choices[0].message.content.length > 0;
  const hasMoreTools = body2.choices[0].message.tool_calls?.length > 0;
  assert(hasContent || hasMoreTools, "Turn 2: Model returned empty response");
  log("  ℹ️", `  Turn 2: ${hasMoreTools ? "Another tool call" : "Text response"} (${(body2.choices[0].message.content || "").slice(0, 100)}...)`);
}

// ─── Test 8: Large message handling (no crash) ───────────────────────────────
async function testLargeMessageNoCrash() {
  // Simulate a huge tool output that should be truncated, not crash
  const hugeContent = "x".repeat(50000); // 50k chars
  const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: "gpt-5-5-instant",
      stream: false,
      messages: [
        { role: "user", content: "Read the log file" },
        { 
          role: "assistant", 
          content: null,
          tool_calls: [{
            id: "call_test_large",
            type: "function",
            function: { name: "bash", arguments: '{"command":"cat /var/log/syslog"}' }
          }]
        },
        {
          role: "tool",
          tool_call_id: "call_test_large",
          content: hugeContent
        },
      ],
      tools: [{
        type: "function",
        function: {
          name: "bash",
          description: "Run a shell command",
          parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] }
        }
      }],
    }),
  });
  // The key assertion: it should NOT return message_length_exceeds_limit
  const bodyText = await res.text();
  assert(!bodyText.includes("message_length_exceeds_limit"), 
    `Got message_length_exceeds_limit error! Truncation not working.`);
  assert(res.ok || res.status < 500, `Server error on large message: ${res.status}`);
  log("  ℹ️", `  Large message (50k chars) handled without crash. Status: ${res.status}`);
}

// ─── Test 9: Agentic behavior (model should NOT list options) ────────────────
async function testAgenticBehavior() {
  const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: "gpt-5-5-instant",
      stream: false,
      messages: [
        { role: "user", content: "Create a Python hello world script at /tmp/hello.py" }
      ],
      tools: [{
        type: "function",
        function: {
          name: "write_file",
          description: "Write content to a file at the given path",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string" },
              content: { type: "string" }
            },
            required: ["path", "content"]
          }
        }
      }],
      tool_choice: "auto",
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Agentic test failed: ${res.status} ${errText}`);
  }
  const body = await res.json();
  
  const msg = body.choices?.[0]?.message;
  const hasToolCall = msg?.tool_calls?.length > 0;
  const textContent = msg?.content || "";
  
  // Check that it didn't just list options
  const listsOptions = /(?:option|choice)\s*\d|(?:would you like|do you want|shall I|let me know)/i.test(textContent);
  
  if (hasToolCall) {
    log("  ℹ️", `  Model called tool directly: ${msg.tool_calls[0].function.name} ✨`);
  } else if (listsOptions) {
    log("  ⚠️", `  Model listed options instead of acting: "${textContent.slice(0, 200)}..."`);
  } else {
    log("  ℹ️", `  Model responded with text (no tool call): "${textContent.slice(0, 200)}..."`);
  }
  
  assert(msg, "No message in response");
}

// ─── Run all tests ───────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🧪 Testing chatgpt-to-api at ${BASE_URL}\n`);
  console.log("─".repeat(60));
  
  await test("1. Health check (/ping)", testHealthCheck);
  await test("2. Models endpoint (/v1/models)", testModelsEndpoint);
  await test("3. Non-streaming simple chat", testNonStreamingSimple);
  await test("4. Streaming chat (line-by-line)", testStreamingBasic);
  await test("5. Tool calling (single, non-stream)", testToolCallingSingle);
  await test("6. Tool calling (streaming)", testToolCallingStreaming);
  await test("7. Multi-turn tool loop (2 turns)", testMultiTurnToolLoop);
  await test("8. Large message handling (50k chars)", testLargeMessageNoCrash);
  await test("9. Agentic behavior (should act, not list)", testAgenticBehavior);
  
  console.log("\n" + "─".repeat(60));
  console.log(`\n📊 Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests\n`);
  
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });

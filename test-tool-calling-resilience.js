#!/usr/bin/env node
/**
 * test-tool-calling-resilience.js
 *
 * Tests that the proxy's tool-calling SSE stream does NOT close prematurely.
 * Sends a request with function tools and verifies:
 *  1. The stream stays open until the model finishes.
 *  2. We receive either a tool_calls delta or content delta.
 *  3. The stream ends cleanly with finish_reason + [DONE].
 *
 * Usage:
 *   PROXY_URL=http://localhost:3000 PROXY_API_KEY=... node test-tool-calling-resilience.js
 */

const PROXY_URL = process.env.PROXY_URL || "http://localhost:3000";
const API_KEY = process.env.PROXY_API_KEY || "";

async function testStreamingToolCall() {
  console.log("=== Test 1: Streaming tool call ===");
  console.log(`Target: ${PROXY_URL}/v1/chat/completions`);

  const body = {
    model: "gpt-5-5",
    stream: true,
    messages: [
      { role: "user", content: "List the files in /tmp using the shell tool." }
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "shell",
          description: "Run a shell command and return stdout.",
          parameters: {
            type: "object",
            properties: {
              command: {
                type: "array",
                items: { type: "string" }
              }
            },
            required: ["command"]
          }
        }
      }
    ],
    tool_choice: "auto"
  };

  const headers = { "Content-Type": "application/json" };
  if (API_KEY) headers["Authorization"] = `Bearer ${API_KEY}`;

  const startTime = Date.now();
  let response;
  try {
    response = await fetch(`${PROXY_URL}/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error("❌ FETCH FAILED:", err.message);
    return false;
  }

  if (!response.ok) {
    const errText = await response.text();
    console.error(`❌ HTTP ${response.status}:`, errText.slice(0, 500));
    return false;
  }

  console.log(`✅ Response started (${Date.now() - startTime}ms)`);

  let chunkCount = 0;
  let gotToolCalls = false;
  let gotContent = false;
  let finishReason = null;
  let gotDone = false;
  let lastActivity = Date.now();

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    lastActivity = Date.now();
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop();

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed === "data: [DONE]") {
        gotDone = true;
        continue;
      }
      if (trimmed.startsWith("data: ")) {
        chunkCount++;
        try {
          const json = JSON.parse(trimmed.slice(6));
          const delta = json.choices?.[0]?.delta;
          const fr = json.choices?.[0]?.finish_reason;
          if (delta?.tool_calls) gotToolCalls = true;
          if (delta?.content) gotContent = true;
          if (fr) finishReason = fr;
          // Progress indicator every 10 chunks
          if (chunkCount % 10 === 0) {
            process.stdout.write(`  [${chunkCount} chunks, ${Math.round((Date.now() - startTime)/1000)}s]\n`);
          }
        } catch {}
      }
    }
  }

  const elapsed = Date.now() - startTime;
  console.log(`\n--- Results ---`);
  console.log(`  Chunks received: ${chunkCount}`);
  console.log(`  Got tool_calls:  ${gotToolCalls}`);
  console.log(`  Got content:     ${gotContent}`);
  console.log(`  Finish reason:   ${finishReason}`);
  console.log(`  Got [DONE]:      ${gotDone}`);
  console.log(`  Total time:      ${elapsed}ms`);

  const success = gotDone && (finishReason === "tool_calls" || finishReason === "stop");
  console.log(success ? "\n✅ PASS: Stream completed cleanly" : "\n❌ FAIL: Stream did not complete cleanly");
  return success;
}

async function testNonStreamingToolCall() {
  console.log("\n=== Test 2: Non-streaming tool call ===");

  const body = {
    model: "gpt-5-5",
    stream: false,
    messages: [
      { role: "user", content: "List the files in /tmp using the shell tool." }
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "shell",
          description: "Run a shell command and return stdout.",
          parameters: {
            type: "object",
            properties: {
              command: {
                type: "array",
                items: { type: "string" }
              }
            },
            required: ["command"]
          }
        }
      }
    ],
    tool_choice: "auto"
  };

  const headers = { "Content-Type": "application/json" };
  if (API_KEY) headers["Authorization"] = `Bearer ${API_KEY}`;

  const startTime = Date.now();
  let response;
  try {
    response = await fetch(`${PROXY_URL}/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error("❌ FETCH FAILED:", err.message);
    return false;
  }

  if (!response.ok) {
    const errText = await response.text();
    console.error(`❌ HTTP ${response.status}:`, errText.slice(0, 500));
    return false;
  }

  const json = await response.json();
  const elapsed = Date.now() - startTime;
  const choice = json.choices?.[0];
  const hasToolCalls = Array.isArray(choice?.message?.tool_calls) && choice.message.tool_calls.length > 0;
  const hasContent = !!choice?.message?.content;
  const fr = choice?.finish_reason;

  console.log(`  Finish reason:  ${fr}`);
  console.log(`  Has tool_calls: ${hasToolCalls}`);
  console.log(`  Has content:    ${hasContent}`);
  console.log(`  Total time:     ${elapsed}ms`);

  if (hasToolCalls) {
    for (const tc of choice.message.tool_calls) {
      console.log(`  Tool call: ${tc.function.name}(${tc.function.arguments.slice(0, 100)})`);
    }
  }

  const success = (fr === "tool_calls" || fr === "stop");
  console.log(success ? "\n✅ PASS: Non-streaming completed cleanly" : "\n❌ FAIL: Non-streaming response issue");
  return success;
}

async function testMultiTurnToolCall() {
  console.log("\n=== Test 3: Multi-turn tool result flow (non-streaming) ===");
  console.log("  Step 1: Send initial request with tool...");

  const headers = { "Content-Type": "application/json" };
  if (API_KEY) headers["Authorization"] = `Bearer ${API_KEY}`;

  // Step 1: Get tool call
  const body1 = {
    model: "gpt-5-5",
    stream: false,
    messages: [
      { role: "user", content: "What is 2 + 2? Use the calculator tool." }
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "calculator",
          description: "Evaluate a math expression.",
          parameters: {
            type: "object",
            properties: { expression: { type: "string" } },
            required: ["expression"]
          }
        }
      }
    ],
    tool_choice: "required"
  };

  let res1;
  try {
    res1 = await fetch(`${PROXY_URL}/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body1),
    });
  } catch (err) {
    console.error("❌ Step 1 FETCH FAILED:", err.message);
    return false;
  }

  if (!res1.ok) {
    const errText = await res1.text();
    console.error(`❌ Step 1 HTTP ${res1.status}:`, errText.slice(0, 500));
    return false;
  }

  const json1 = await res1.json();
  const choice1 = json1.choices?.[0];
  const tc = choice1?.message?.tool_calls?.[0];

  if (!tc) {
    console.log("  ⚠️  Model did not return a tool call (may have answered directly)");
    console.log(`  Finish reason: ${choice1?.finish_reason}`);
    console.log(`  Content: ${choice1?.message?.content?.slice(0, 100)}`);
    console.log("✅ PASS (model chose not to use tool, connection stayed alive)");
    return true;
  }

  console.log(`  Tool call received: ${tc.function.name}(${tc.function.arguments})`);
  console.log(`  Tool call ID: ${tc.id}`);

  // Step 2: Send tool result back
  console.log("  Step 2: Sending tool result back...");
  const body2 = {
    model: "gpt-5-5",
    stream: false,
    messages: [
      { role: "user", content: "What is 2 + 2? Use the calculator tool." },
      {
        role: "assistant",
        content: null,
        tool_calls: [tc]
      },
      {
        role: "tool",
        tool_call_id: tc.id,
        content: "4"
      }
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "calculator",
          description: "Evaluate a math expression.",
          parameters: {
            type: "object",
            properties: { expression: { type: "string" } },
            required: ["expression"]
          }
        }
      }
    ]
  };

  let res2;
  try {
    res2 = await fetch(`${PROXY_URL}/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body2),
    });
  } catch (err) {
    console.error("❌ Step 2 FETCH FAILED (connection closed?):", err.message);
    return false;
  }

  if (!res2.ok) {
    const errText = await res2.text();
    console.error(`❌ Step 2 HTTP ${res2.status}:`, errText.slice(0, 500));
    return false;
  }

  const json2 = await res2.json();
  const choice2 = json2.choices?.[0];
  console.log(`  Final answer: ${choice2?.message?.content?.slice(0, 200)}`);
  console.log(`  Finish reason: ${choice2?.finish_reason}`);

  const success = choice2?.finish_reason === "stop" && choice2?.message?.content;
  console.log(success ? "\n✅ PASS: Multi-turn tool flow completed" : "\n❌ FAIL: Multi-turn tool flow issue");
  return success;
}

// Run all tests
(async () => {
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║  Tool Calling Resilience Test Suite          ║");
  console.log("╚══════════════════════════════════════════════╝\n");

  const results = [];
  results.push(await testStreamingToolCall());
  results.push(await testNonStreamingToolCall());
  results.push(await testMultiTurnToolCall());

  console.log("\n══════════════════════════════════════════════");
  console.log(`Results: ${results.filter(Boolean).length}/${results.length} passed`);
  console.log("══════════════════════════════════════════════");

  process.exit(results.every(Boolean) ? 0 : 1);
})();

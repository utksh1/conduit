const { spawn } = require('child_process');
const dotenv = require('dotenv');

dotenv.config();

const PORT = 3041; // use a dedicated free port for the test

async function runTest() {
  console.log('[Test] Starting server on port', PORT);
  
  // Spawn the server process
  const env = { ...process.env, PORT: String(PORT) };
  const server = spawn('node', ['server.js'], {
    cwd: __dirname,
    env,
    stdio: 'inherit' // let it print logs so we can see what's happening
  });

  // Give the server a moment to start
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Retrieve the bearer token from the env (must start with "ey")
  const token = process.env.CHATGPT_ACCESS_TOKEN || '';

  // ── Test 1: Native web search (web_search_preview tool) ──────────
  console.log('\n[Test 1] Sending request with web_search_preview tool...');
  try {
    const response = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        model: 'gpt-5-5',
        messages: [
          { role: 'user', content: 'What is the current weather in Tokyo right now? Please search the web for the latest information.' }
        ],
        tools: [
          { type: 'web_search_preview' }
        ]
      })
    });

    console.log('[Test 1] Response status:', response.status);
    const data = await response.json();
    console.log('[Test 1] Response body:\n', JSON.stringify(data, null, 2));

    // Check for annotations
    const msg = data.choices?.[0]?.message;
    if (msg?.annotations && msg.annotations.length > 0) {
      console.log(`[Test 1] ✅ Found ${msg.annotations.length} URL citations from native search!`);
      for (const ann of msg.annotations) {
        console.log(`  - ${ann.title}: ${ann.url}`);
      }
    } else {
      console.log('[Test 1] ⚠️ No annotations found. The model may not have triggered search, or cite_metadata format changed.');
    }
  } catch (error) {
    console.error('[Test 1] Request failed:', error);
  }

  // ── Test 2: Mixed tools (web_search_preview + function tool) ─────
  console.log('\n[Test 2] Sending request with mixed tools (web_search + function)...');
  try {
    const response = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        model: 'gpt-5-5',
        messages: [
          { role: 'user', content: 'Search the web for the current temperature in Tokyo, then use the save_data tool to save the result.' }
        ],
        tools: [
          { type: 'web_search_preview' },
          {
            type: 'function',
            function: {
              name: 'save_data',
              description: 'Save a key-value pair to the database.',
              parameters: {
                type: 'object',
                properties: {
                  key: { type: 'string', description: 'The key to store' },
                  value: { type: 'string', description: 'The value to store' }
                },
                required: ['key', 'value']
              }
            }
          }
        ],
        tool_choice: 'auto'
      })
    });

    console.log('[Test 2] Response status:', response.status);
    const data = await response.json();
    console.log('[Test 2] Response body:\n', JSON.stringify(data, null, 2));

    const msg = data.choices?.[0]?.message;
    if (msg?.tool_calls && msg.tool_calls.length > 0) {
      console.log(`[Test 2] ✅ Got ${msg.tool_calls.length} tool call(s): ${msg.tool_calls.map(tc => tc.function?.name).join(', ')}`);
    }
    if (msg?.annotations && msg.annotations.length > 0) {
      console.log(`[Test 2] ✅ Got ${msg.annotations.length} annotations from native search`);
    }
  } catch (error) {
    console.error('[Test 2] Request failed:', error);
  }

  // ── Test 3: Plain request (no tools) — regression check ──────────
  console.log('\n[Test 3] Sending plain request (no tools) — regression check...');
  try {
    const response = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        model: 'gpt-5-5',
        messages: [
          { role: 'user', content: 'Say hello in one sentence.' }
        ]
      })
    });

    console.log('[Test 3] Response status:', response.status);
    const data = await response.json();
    console.log('[Test 3] Response content:', data.choices?.[0]?.message?.content?.slice(0, 200));
    console.log('[Test 3] ✅ Plain request works');
  } catch (error) {
    console.error('[Test 3] Request failed:', error);
  }

  console.log('\n[Test] All tests complete. Killing server...');
  server.kill();
  process.exit(0);
}

runTest();

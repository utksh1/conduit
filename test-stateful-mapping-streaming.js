const { spawn } = require('child_process');
const dotenv = require('dotenv');

dotenv.config();

const PORT = 3043; // use a dedicated free port for the test

async function readStream(response, onChunk) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value);
    const lines = buffer.split('\n');
    buffer = lines.pop();
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('data: ')) {
        const jsonStr = trimmed.slice(6);
        if (jsonStr === '[DONE]') continue;
        const parsed = JSON.parse(jsonStr);
        onChunk(parsed);
      }
    }
  }
}

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
  await new Promise((resolve) => setTimeout(resolve, 3000));

  // Retrieve the bearer token from the env (must start with "ey" or be PROXY_API_KEY)
  const token = process.env.PROXY_API_KEY || '';

  // ── Test 1: First turn (streaming) ──────────────────
  console.log('\n[Test 1] Sending first turn (streaming)...');
  let response1Text = '';
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
          { role: 'user', content: 'Hello, my name is Utkarsh and I am an iOS developer.' }
        ],
        stream: true
      })
    });

    console.log('[Test 1] Response status:', response.status);
    await readStream(response, (chunk) => {
      const content = chunk.choices?.[0]?.delta?.content || '';
      if (content) {
        response1Text += content;
        process.stdout.write(content);
      }
    });
    console.log('\n[Test 1] Final Assistant Reply:', response1Text);
  } catch (error) {
    console.error('[Test 1] Request failed:', error);
  }

  if (!response1Text) {
    console.error('[Test] Test 1 failed. Aborting.');
    server.kill();
    process.exit(1);
  }

  // Give a short pause
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // ── Test 2: Second turn (streaming with stateful cache HIT) ─────────
  console.log('\n[Test 2] Sending second turn (streaming, multi-turn history)...');
  let response2Text = '';
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
          { role: 'user', content: 'Hello, my name is Utkarsh and I am an iOS developer.' },
          { role: 'assistant', content: response1Text },
          { role: 'user', content: 'What did I say my name was? And what is my job?' }
        ],
        stream: true
      })
    });

    console.log('[Test 2] Response status:', response.status);
    await readStream(response, (chunk) => {
      const content = chunk.choices?.[0]?.delta?.content || '';
      if (content) {
        response2Text += content;
        process.stdout.write(content);
      }
    });
    console.log('\n[Test 2] Final Assistant Reply:', response2Text);
    
    if (response2Text.toLowerCase().includes('utkarsh') && response2Text.toLowerCase().includes('ios')) {
      console.log('[Test 2] ✅ Successfully remembered name and job statefully with streaming!');
    } else {
      console.log('[Test 2] ❌ Failed to remember name/job in stateful streaming conversation.');
    }
  } catch (error) {
    console.error('[Test 2] Request failed:', error);
  }

  // Kill the server process
  console.log('\n[Test] Stopping server...');
  server.kill();
  console.log('[Test] Finished.');
}

runTest();

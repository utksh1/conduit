const { spawn } = require('child_process');
const dotenv = require('dotenv');

dotenv.config();

const PORT = 3042; // use a dedicated free port for the test

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

  // ── Test 1: First turn (new stateful conversation) ──────────────────
  console.log('\n[Test 1] Sending first turn...');
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
        stream: false
      })
    });

    console.log('[Test 1] Response status:', response.status);
    const data = await response.json();
    console.log('[Test 1] Response body:\n', JSON.stringify(data, null, 2));

    response1Text = data.choices?.[0]?.message?.content || '';
    console.log('[Test 1] Assistant Reply:', response1Text);
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

  // ── Test 2: Second turn (should trigger stateful cache HIT) ─────────
  console.log('\n[Test 2] Sending second turn (multi-turn history)...');
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
        stream: false
      })
    });

    console.log('[Test 2] Response status:', response.status);
    const data = await response.json();
    console.log('[Test 2] Response body:\n', JSON.stringify(data, null, 2));

    const reply = data.choices?.[0]?.message?.content || '';
    console.log('[Test 2] Assistant Reply:', reply);
    if (reply.toLowerCase().includes('utkarsh') && reply.toLowerCase().includes('ios')) {
      console.log('[Test 2] ✅ Successfully remembered name and job statefully!');
    } else {
      console.log('[Test 2] ❌ Failed to remember name/job in stateful conversation.');
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

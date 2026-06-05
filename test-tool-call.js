const { spawn } = require('child_process');
const dotenv = require('dotenv');

dotenv.config();

const PORT = 3040; // use a dedicated free port for the test

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

  console.log('\n[Test] Sending request to test tool calling...');
  
  // Retrieve the bearer token from the env (must start with "ey")
  const token = process.env.CHATGPT_ACCESS_TOKEN || '';
  
  try {
    const response = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        model: 'gpt-5-5-thinking', // using a supported model slug from SUPPORTED_MODELS
        messages: [
          { role: 'user', content: 'What is the current temperature in Tokyo right now? Please call the get_weather tool with city="Tokyo".' }
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'get_weather',
              description: 'Fetch the weather for a given city.',
              parameters: {
                type: 'object',
                properties: {
                  city: { type: 'string', description: 'The city name, e.g. Tokyo' }
                },
                required: ['city']
              }
            }
          }
        ],
        tool_choice: 'auto'
      })
    });

    console.log('[Test] Response status:', response.status);
    const data = await response.json();
    console.log('[Test] Response body:\n', JSON.stringify(data, null, 2));

  } catch (error) {
    console.error('[Test] Request failed:', error);
  } finally {
    console.log('[Test] Killing server...');
    server.kill();
    process.exit(0);
  }
}

runTest();

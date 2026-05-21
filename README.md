# Unofficial ChatGPT-to-OpenAI API Gateway

This is a lightweight, zero-dependency Node.js Express server that acts as a local proxy. It allows you to use your web-based ChatGPT account as a standard OpenAI-compatible API endpoint inside any client or library (e.g. IDE extensions like Cursor/Continue, frontends like LobeChat, or custom scripts).

## How It Works

1. **Session Wrapping**: The proxy logs into your web account using your long-lived `__Secure-next-auth.session-token` browser cookie and automatically fetches/refreshes the short-lived `accessToken` on the fly.
2. **Translation**: It translates stateless `/v1/chat/completions` requests into the single-node conversation format expected by `chatgpt.com/backend-api/conversation`.
3. **SSE Delta Extraction**: It converts ChatGPT's accumulated-stream chunks into standard OpenAI chunk deltas so text displays beautifully in real-time.

## Model Routing Reality Check

This proxy exposes an OpenAI-compatible API surface, but it routes to ChatGPT Web (`chatgpt.com/backend-api/conversation`) under the hood. In practice:

- `GET /v1/models` is a hardcoded compatibility list (for clients that expect the endpoint), not a live probe of which upstream models you can actually use.
- The upstream endpoint may ignore an unrecognized/unauthorized `model` value and silently route you elsewhere.
- Asking the assistant to “self-identify” its model is not reliable.

For debugging, `server.js` attempts to extract an upstream model slug from the ChatGPT SSE payload (when present) and returns it as `response.model`. If no upstream model slug is present, the proxy falls back to echoing the requested model id.

---

## 🛠️ Step-by-Step Setup Guide

### 1. Extract Your Session Cookie
To let the server call ChatGPT on your behalf, you need to copy your long-lived session cookie:

1. Open your browser and go to [https://chatgpt.com](https://chatgpt.com). Make sure you are logged in.
2. Press `F12` or `Cmd + Option + I` to open the developer tools.
3. Navigate to the **Application** tab (Chrome/Edge/Safari) or **Storage** tab (Firefox).
4. In the left panel, expand **Cookies** and select `https://chatgpt.com`.
5. Look for the cookie named **`__Secure-next-auth.session-token`**.
6. Copy its **Value** (it is a very long string of characters).

---

### 2. Configure Environment Variables
Open the `.env` file in the project folder and paste your copied token:

```env
PORT=3000

# Paste your copied session token here:
CHATGPT_SESSION_TOKEN=eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIn0...

# (Optional) Add a local API key to protect your proxy server:
PROXY_API_KEY=

# Default model id to send upstream when the client omits "model"
DEFAULT_MODEL=auto
```

---

### 3. Start the Server
Run the following commands to install dependencies and start the server:

```bash
# Install dependencies (only required the first time)
npm install

# Start the proxy server
npm start
```

If the configured port is already in use, override it:

```bash
PORT=3002 npm start
```

You should see:
```text
====================================================
 ChatGPT Unofficial API Proxy Server is running!
 Listening on: http://localhost:3000
 Base API endpoint: http://localhost:3000/v1
====================================================
```

---

## 🚀 How to Integrate and Use Your Endpoint

Once the proxy is running, you can connect it to any client by swapping the API base URL.

### 1. Using `curl` (Testing the API)

**Streaming Request (Recommended):**
```bash
curl -N http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Tell me a 3-word story."}],
    "stream": true
  }'
```

**Non-Streaming Request:**
```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "What is 2+2?"}]
  }'
```

---

### 2. In Python (with standard `openai` library)
Set the `api_key` to a dummy value (or your `PROXY_API_KEY` if configured) and configure `base_url` to point to your local proxy:

```python
from openai import OpenAI

client = OpenAI(
    api_key="anything",  # Or your PROXY_API_KEY
    base_url="http://localhost:3000/v1"
)

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[
        {"role": "user", "content": "Why is the sky blue?"}
    ],
    stream=True
)

for chunk in response:
    content = chunk.choices[0].delta.content
    if content:
        print(content, end="", flush=True)
print()
```

---

### 3. In Node.js (with official `openai` library)
```javascript
const { OpenAI } = require("openai");

const openai = new OpenAI({
  apiKey: "anything", // Or your PROXY_API_KEY
  baseURL: "http://localhost:3000/v1"
});

async function main() {
  const stream = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: "Write a short poem about coding." }],
    stream: true,
  });
  
  for await (const chunk of stream) {
    process.stdout.write(chunk.choices[0]?.delta?.content || "");
  }
}

main();
```

---

### 4. Inside Desktop AI Clients (e.g. LobeChat, NextChat, LibreChat)
Most UI clients allow adding a custom OpenAI provider or overriding the Base URL:
- **API Key**: Set to any text (e.g. `dummy` or your `PROXY_API_KEY`).
- **Proxy/Base URL**: Set to `http://localhost:3000/v1`.

### 5. Inside Cursor IDE or VS Code Extensions (e.g. Continue)
For **Continue** config:
```json
{
  "models": [
    {
      "title": "ChatGPT Local Proxy",
      "provider": "openai",
      "model": "gpt-4o",
      "apiBase": "http://localhost:3000/v1",
      "apiKey": "anything"
    }
  ]
}
```

---

## 🧪 Verify What The Proxy Reports As The Model

With the server running, you can run:

```bash
BASE_URL=http://localhost:3000/v1 node scripts/verify-models.mjs
```

This script calls `GET /v1/models`, then sends one non-streaming request per model id and prints the requested model id plus the proxy's `response.model` (which may be an upstream slug if the upstream provided one).

## ⚠️ Essential Notices & Disclaimers
- **Rate Limits & IP Blocks**: This proxy uses your browser's session, which means you are subject to the same rate limits and IP checks as the ChatGPT web application. If you make too many fast parallel requests, your IP may get flagged by Cloudflare or your account temporarily rate-limited.
- **Account Security**: Keep your `__Secure-next-auth.session-token` secure. Sharing it or checking it into Git gives anyone full control of your ChatGPT account!
- **Terms of Service**: This is an unofficial tool and violates OpenAI's terms of service regarding automated scraping. Use it strictly for personal experimentation and evaluation.

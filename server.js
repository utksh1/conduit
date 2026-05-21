const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { v4: uuidv4 } = require("uuid");
const crypto = require("crypto");
const swaggerUi = require("swagger-ui-express");
const swaggerJSDoc = require("swagger-jsdoc");
// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());

// Backend-only service: no static frontend is served.

// Token Cache
let cachedAccessToken = null;
let tokenExpiresAt = null;

// OpenAPI / Swagger (kept small and hand-maintained for this gateway)
const openApiSpec = swaggerJSDoc({
  definition: {
    openapi: "3.0.3",
    info: {
      title: "ChatGPT-to-API Gateway",
      version: "1.0.0",
      description:
        "Unofficial OpenAI-compatible Chat Completions gateway backed by ChatGPT Web.",
    },
    servers: [{ url: "http://localhost:" + PORT, description: "Local" }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer" },
      },
      schemas: {
        ChatCompletionMessage: {
          type: "object",
          required: ["role", "content"],
          properties: {
            role: {
              type: "string",
              enum: ["system", "user", "assistant", "tool"],
            },
            content: { type: ["string", "null"] },
            name: { type: "string" },
          },
        },
        ChatCompletionsRequest: {
          type: "object",
          required: ["messages"],
          properties: {
            model: {
              type: "string",
              description:
                "Requested model id. Upstream routing may ignore this value.",
            },
            messages: {
              type: "array",
              items: { $ref: "#/components/schemas/ChatCompletionMessage" },
            },
            stream: { type: "boolean", default: false },
          },
          additionalProperties: true,
        },
      },
    },
    paths: {
      "/ping": {
        get: {
          summary: "Health check",
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      status: { type: "string" },
                      time: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/v1/models": {
        get: {
          summary: "List models (compatibility list)",
          responses: {
            "200": {
              description: "List of model ids",
            },
          },
        },
      },
      "/v1/chat/completions": {
        post: {
          summary: "Chat Completions (OpenAI-compatible)",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ChatCompletionsRequest" },
              },
            },
          },
          responses: {
            "200": { description: "Chat completion response (JSON or SSE)" },
            "400": { description: "Bad request" },
            "401": { description: "Unauthorized" },
            "500": { description: "Server error" },
          },
        },
      },
    },
  },
  apis: [],
});

app.get("/openapi.json", (req, res) => res.json(openApiSpec));
app.use("/docs", swaggerUi.serve, swaggerUi.setup(openApiSpec));

/**
 * Formats a stateless list of OpenAI-style messages into a single, cohesive
 * prompt suitable for ChatGPT's single-node conversation format.
 */
function formatMessages(messages) {
  if (!messages || messages.length === 0) return "";
  if (messages.length === 1) return messages[0].content;

  let formatted = "";
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const role = msg.role.charAt(0).toUpperCase() + msg.role.slice(1);
    
    if (i === messages.length - 1) {
      // Mark the current instruction explicitly so the model follows it
      formatted += `\n[Current Instruction]\n${role}: ${msg.content}`;
    } else {
      if (i === 0) {
        formatted += `[Conversation Context]\n`;
      }
      formatted += `${role}: ${msg.content}\n`;
    }
  }
  return formatted;
}

/**
 * Fetches a short-lived accessToken using the long-lived browser session token.
 */
async function refreshAccessToken(sessionToken) {
  if (!sessionToken || sessionToken === "your_session_token_here") {
    throw new Error("CHATGPT_SESSION_TOKEN is not configured in .env. Please copy it from your chatgpt.com cookies.");
  }

  const cookieHeader = process.env.CHATGPT_COOKIES || `__Secure-next-auth.session-token=${sessionToken}`;
  const response = await fetch("https://chatgpt.com/api/auth/session", {
    headers: {
      "Cookie": cookieHeader,
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "application/json"
    }
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Session refresh failed with status ${response.status}: ${errText}`);
  }

  const data = await response.json();
  if (!data.accessToken) {
    console.error("[Proxy] Received session payload:", JSON.stringify(data));
    throw new Error("No accessToken returned in session payload. Your session token might be invalid or expired.");
  }

  return {
    accessToken: data.accessToken,
    expires: new Date(data.expires || Date.now() + 3600 * 1000)
  };
}

/**
 * Gets a valid access token, refreshing it if expired or missing.
 */
async function getAccessToken() {
  // If the user provided a static, direct Access Token in .env, use it directly!
  if (process.env.CHATGPT_ACCESS_TOKEN && process.env.CHATGPT_ACCESS_TOKEN.startsWith("ey")) {
    return process.env.CHATGPT_ACCESS_TOKEN;
  }

  const sessionToken = process.env.CHATGPT_SESSION_TOKEN;
  
  if (cachedAccessToken && tokenExpiresAt && tokenExpiresAt > new Date()) {
    return cachedAccessToken;
  }

  console.log("[Proxy] Refreshing Access Token from ChatGPT session...");
  try {
    const { accessToken, expires } = await refreshAccessToken(sessionToken);
    cachedAccessToken = accessToken;
    // Expire cache 5 minutes early as a safety buffer
    tokenExpiresAt = new Date(expires.getTime() - 5 * 60 * 1000);
    console.log("[Proxy] Token successfully refreshed. Cached until:", tokenExpiresAt.toISOString());
    return cachedAccessToken;
  } catch (err) {
    console.error("[Proxy] Token refresh error:", err.message);
    throw err;
  }
}

// Sentinel PoW Functions
const DEVICE_ID = uuidv4(); // Persistent device ID for this server instance

async function getChatRequirements(accessToken, cookieHeader) {
  console.log('[Proxy] Fetching sentinel chat requirements...');
  const resp = await fetch("https://chatgpt.com/backend-api/sentinel/chat-requirements", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Cookie": cookieHeader,
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Oai-Device-Id": DEVICE_ID,
      "Oai-Language": "en-US",
      "Accept": "*/*",
      "Origin": "https://chatgpt.com",
      "Referer": "https://chatgpt.com/"
    },
    body: JSON.stringify({})
  });
  if (!resp.ok) {
    const errText = await resp.text();
    console.error('[Proxy] Sentinel requirements fetch error', resp.status, errText.slice(0, 500));
    throw new Error(`Sentinel requirements fetch failed: ${resp.status}`);
  }
  const data = await resp.json();
  console.log('[Proxy] Sentinel requirements received:', JSON.stringify({
    token: data.token ? data.token.slice(0, 20) + '...' : null,
    proofofwork: data.proofofwork
  }));
  return data;
}

function calcProofToken(seed, difficulty, userAgent) {
  if (!seed || !difficulty) {
    console.warn('[Proxy] No seed/difficulty provided, skipping PoW');
    return null;
  }

  const diffLen = Math.floor(difficulty.length / 2);
  const cores = [8, 12, 16, 24];
  const screens = [3000, 4000, 6000];
  const core = cores[Math.floor(Math.random() * cores.length)];
  const screen = screens[Math.floor(Math.random() * screens.length)];

  // Format timestamp like a browser would
  const now = new Date();
  const timeStr = now.toUTCString().replace("GMT", "GMT+0000 (Coordinated Universal Time)");

  const config = [
    core + screen,       // cores + screen identifier
    timeStr,             // formatted timestamp
    4294705152,          // magic number (screen/performance constant)
    0,                   // nonce placeholder
    userAgent || "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  ];

  const startTime = Date.now();

  for (let i = 0; i < 100000; i++) {
    config[3] = i;
    const jsonStr = JSON.stringify(config);
    const base = Buffer.from(jsonStr).toString('base64');
    const hashInput = seed + base;
    const hash = crypto.createHash('sha3-512').update(hashInput).digest('hex');

    // Compare first diffLen chars of hash against difficulty
    if (hash.substring(0, diffLen) <= difficulty) {
      const elapsed = Date.now() - startTime;
      console.log(`[Proxy] PoW solved! nonce=${i}, elapsed=${elapsed}ms`);
      return "gAAAAAB" + base;
    }
  }

  console.warn('[Proxy] PoW not solved after 100000 iterations, returning fallback');
  // Return a fallback token with last attempted config
  const fallbackBase = Buffer.from(JSON.stringify(config)).toString('base64');
  return "gAAAAAB" + fallbackBase;
}

// Health Check Endpoint
app.get("/ping", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// Models Endpoint (for OpenAI client compatibility)
app.get("/v1/models", (req, res) => {
  res.json({
    object: "list",
    data: [
      { id: "gpt-5-5", object: "model", created: 1715644800, owned_by: "openai" },
      { id: "gpt-5-5-instant", object: "model", created: 1715644800, owned_by: "openai" },
      { id: "gpt-5-5-thinking", object: "model", created: 1715644800, owned_by: "openai" },
      { id: "gpt-5-4-thinking", object: "model", created: 1715644800, owned_by: "openai" },
      { id: "gpt-5-3-instant", object: "model", created: 1715644800, owned_by: "openai" },
      { id: "gpt-5-2-instant", object: "model", created: 1715644800, owned_by: "openai" },
      { id: "gpt-5-2-thinking", object: "model", created: 1715644800, owned_by: "openai" },
      { id: "o3", object: "model", created: 1715644800, owned_by: "openai" }
    ]
  });
});

// Chat Completions Endpoint
app.post("/v1/chat/completions", async (req, res) => {
  // 1. Authenticate Request
  const authHeader = req.headers["authorization"] || "";
  const clientToken = authHeader.replace("Bearer ", "").trim();

  // If local API Key security is enabled, check it
  if (process.env.PROXY_API_KEY) {
    // If the clientToken matches the PROXY_API_KEY, that's fine.
    // If it doesn't match AND it is not a direct ChatGPT Access Token, return 401.
    if (clientToken !== process.env.PROXY_API_KEY && !clientToken.startsWith("ey")) {
      return res.status(401).json({
        error: {
          message: "Invalid or missing Proxy API Key.",
          type: "invalid_request_error",
          code: "unauthorized"
        }
      });
    }
  }

  // 2. Resolve ChatGPT Access Token
  let accessToken = "";
  try {
    // If the client provided a ChatGPT Web access token directly (JWT starts with 'ey'), we can use it
    if (clientToken && clientToken.startsWith("ey")) {
      accessToken = clientToken;
    } else {
      accessToken = await getAccessToken();
    }
  } catch (err) {
    return res.status(401).json({
      error: {
        message: `Failed to authenticate with ChatGPT: ${err.message}`,
        type: "authentication_error",
        code: "invalid_session"
      }
    });
  }

  // 3. Parse and Translate request parameters
  const { messages, model, stream } = req.body;
  
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({
      error: {
        message: "Missing 'messages' array in request body.",
        type: "invalid_request_error",
        code: "bad_request"
      }
    });
  }

  const promptText = formatMessages(messages);
  const targetModel = model || process.env.DEFAULT_MODEL || "auto";
  const parentMessageId = uuidv4();
  const messageId = uuidv4();
  const completionId = `chatcmpl-${uuidv4().replace(/-/g, "").slice(0, 24)}`;
  let upstreamModelSlug = null; // best-effort: what ChatGPT backend says it used (if provided)

  const chatgptPayload = {
    action: "next",
    messages: [
      {
        id: messageId,
        author: {
          role: "user"
        },
        content: {
          content_type: "text",
          parts: [promptText]
        },
        metadata: {}
      }
    ],
    parent_message_id: parentMessageId,
    model: targetModel,
    timezone_offset_min: -330,
    history_and_training_disabled: false,
    conversation_mode: {
      kind: "primary_assistant"
    },
    force_paragen: false,
    force_paragen_model_slug: "",
    force_nulligen: false,
    force_rate_limit: false
  };

  // 4. Send request to ChatGPT Web Backend
  console.log(`[Proxy] Routing request to ChatGPT (Model: ${targetModel}, Stream: ${stream === true})`);
  
  try {
    const cookieHeader = process.env.CHATGPT_COOKIES || `__Secure-next-auth.session-token=${process.env.CHATGPT_SESSION_TOKEN}`;
    // Retrieve Sentinel requirements and compute PoW proof token
    const requirements = await getChatRequirements(accessToken, cookieHeader);
    const pow = requirements.proofofwork || {};
    const proofToken = calcProofToken(pow.seed, pow.difficulty, "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");

    const conversationHeaders = {
      "Content-Type": "application/json",
      "Accept": "text/event-stream",
      "Authorization": `Bearer ${accessToken}`,
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Oai-Client-Version": "2024.12.11",
      "Oai-Device-Id": DEVICE_ID,
      "Oai-Language": "en-US",
      "Cookie": cookieHeader
    };
    if (requirements.token) {
      conversationHeaders["Openai-Sentinel-Chat-Requirements-Token"] = requirements.token;
    }
    if (proofToken) {
      conversationHeaders["Openai-Sentinel-Proof-Token"] = proofToken;
    }

    const response = await fetch("https://chatgpt.com/backend-api/conversation", {
      method: "POST",
      headers: conversationHeaders,
      body: JSON.stringify(chatgptPayload)
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[Proxy] ChatGPT returned error ${response.status}:`, errText);
      return res.status(response.status).json({
        error: {
          message: `ChatGPT API Error: ${errText}`,
          type: "backend_error",
          code: response.status
        }
      });
    }

    // 5. Stream Handling (SSE)
    if (stream === true) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      let lastText = "";
      let buffer = "";

      for await (const chunk of response.body) {
        buffer += new TextDecoder().decode(chunk);
        const lines = buffer.split("\n");
        buffer = lines.pop(); // Hold remaining incomplete line

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          
          if (trimmed === "data: [DONE]") {
            // Stream complete
            res.write(`data: ${JSON.stringify({
              id: completionId,
              object: "chat.completion.chunk",
              created: Math.floor(Date.now() / 1000),
              model: targetModel,
              choices: [{ index: 0, delta: {}, finish_reason: "stop" }]
            })}\n\n`);
            res.write("data: [DONE]\n\n");
            return res.end();
          }

          if (trimmed.startsWith("data: ")) {
            try {
              const jsonStr = trimmed.slice(6);
              if (jsonStr === "[DONE]") continue;

              const parsed = JSON.parse(jsonStr);
              // Best-effort extraction of upstream-selected model slug (fields vary over time)
              upstreamModelSlug =
                upstreamModelSlug ||
                parsed?.model ||
                parsed?.model_slug ||
                parsed?.message?.metadata?.model_slug ||
                parsed?.message?.metadata?.requested_model_slug ||
                null;
              const message = parsed.message;
              
              if (message && message.author && message.author.role === "assistant") {
                const currentText = message.content?.parts?.[0] || "";
                
                if (currentText && currentText.startsWith(lastText)) {
                  const delta = currentText.slice(lastText.length);
                  lastText = currentText;

                  if (delta) {
                    const chunkPayload = {
                      id: completionId,
                      object: "chat.completion.chunk",
                      created: Math.floor(Date.now() / 1000),
                      model: upstreamModelSlug || targetModel,
                      choices: [
                        {
                          index: 0,
                          delta: {
                            content: delta
                          },
                          finish_reason: null
                        }
                      ]
                    };
                    res.write(`data: ${JSON.stringify(chunkPayload)}\n\n`);
                  }
                }
              }
            } catch (e) {
              // Ignore lines that are not valid JSON
            }
          }
        }
      }

      // Finish cleanly if loop ends
      res.write("data: [DONE]\n\n");
      return res.end();
    } else {
      // 6. Non-Streaming Response Handling
      let fullContent = "";
      let buffer = "";

      for await (const chunk of response.body) {
        buffer += new TextDecoder().decode(chunk);
        const lines = buffer.split("\n");
        buffer = lines.pop();

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (trimmed.startsWith("data: ")) {
            try {
              const jsonStr = trimmed.slice(6);
              if (jsonStr === "[DONE]") continue;

              const parsed = JSON.parse(jsonStr);
              // Best-effort extraction of upstream-selected model slug (fields vary over time)
              upstreamModelSlug =
                upstreamModelSlug ||
                parsed?.model ||
                parsed?.model_slug ||
                parsed?.message?.metadata?.model_slug ||
                parsed?.message?.metadata?.requested_model_slug ||
                null;
              if (parsed.message?.author?.role === "assistant") {
                fullContent = parsed.message.content?.parts?.[0] || fullContent;
              }
            } catch (e) {
              // Ignore
            }
          }
        }
      }

      return res.json({
        id: completionId,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: upstreamModelSlug || targetModel,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: fullContent
            },
            finish_reason: "stop"
          }
        ],
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0
        }
      });
    }

  } catch (err) {
    console.error("[Proxy] Unexpected server error during fetch:", err.message);
    if (!res.headersSent) {
      return res.status(500).json({
        error: {
          message: `Internal server error in Proxy: ${err.message}`,
          type: "api_error",
          code: "internal_server_error"
        }
      });
    }
    res.end();
  }
});

// Start Server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`====================================================`);
  console.log(` ChatGPT Unofficial API Proxy Server is running!`);
  console.log(` Listening on: http://localhost:${PORT}`);
  console.log(` Base API endpoint: http://localhost:${PORT}/v1`);
  console.log(`====================================================`);
});

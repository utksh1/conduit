const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { v4: uuidv4 } = require("uuid");
const crypto = require("crypto");
const swaggerUi = require("swagger-ui-express");
const swaggerJSDoc = require("swagger-jsdoc");
const {
  INTERNAL_BYPASS_TOKEN,
  authenticateRequest,
  installMeterHook,
  reserve,
  estimateTokens,
  estimateMessageTokens,
} = require("./lib/middleware");
// Load environment variables
dotenv.config();

// ── Global crash guards ─────────────────────────────────────────────────────
// Prevent the entire server from going down on stray errors / rejections.
process.on("uncaughtException", (err, origin) => {
  console.error(`[FATAL] Uncaught exception (${origin}):`, err);
});
process.on("unhandledRejection", (reason, promise) => {
  console.error("[FATAL] Unhandled rejection:", reason);
});

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Backend-only service: no static frontend is served.

// Token Cache
let cachedAccessToken = null;
let tokenExpiresAt = null;

// Stateful conversation mapping cache
// Key: SHA-256 hash of serialization of messages array prefix (up to the parent message).
// Value: { conversationId, parentMessageId, originalToolCalls: {} }
const conversationCache = new Map();
const MAX_CACHE_SIZE = 10000;
const SERVER_TOOLS = new Set(["browser", "python", "dalle", "myfiles_browser"]);

function getMessagesHash(messages) {
  if (!messages || messages.length === 0) return "root";
  
  // Create a clean representation of the message array to hash.
  const cleanMessages = messages.map(m => ({
    role: m.role,
    content: typeof m.content === "string" 
      ? m.content 
      : Array.isArray(m.content)
        ? m.content.map(p => p?.text || "").join("")
        : JSON.stringify(m.content ?? ""),
    name: m.name || null,
    tool_calls: m.tool_calls || null,
    tool_call_id: m.tool_call_id || null
  }));
  
  const serialized = JSON.stringify(cleanMessages);
  return crypto.createHash("sha256").update(serialized).digest("hex");
}

function cacheConversationMapping(prefixHash, conversationId, parentMessageId, originalToolCalls = {}) {
  if (conversationCache.size >= MAX_CACHE_SIZE) {
    // Delete the oldest entry (FIFO)
    const firstKey = conversationCache.keys().next().value;
    if (firstKey) conversationCache.delete(firstKey);
  }
  conversationCache.set(prefixHash, { conversationId, parentMessageId, originalToolCalls });
}

// OpenAPI / Swagger spec — describes the OpenAI-compatible surface of this gateway.
const SUPPORTED_MODELS = [
  "gpt-5-5",
  "gpt-5-5-instant",
  "gpt-5-5-thinking",
  "gpt-5-4-thinking",
  "gpt-5-3-instant",
  "gpt-5-2-instant",
  "gpt-5-2-thinking",
  "o3",
];

const openApiSpec = swaggerJSDoc({
  definition: {
    openapi: "3.0.3",
    info: {
      title: "ChatGPT-to-API Gateway",
      version: "1.0.0",
      summary: "OpenAI-compatible gateway for ChatGPT Web",
      description: [
        "An **unofficial** OpenAI-compatible Chat Completions gateway that proxies",
        "requests to ChatGPT Web using your browser session.",
        "",
        "### Quick start",
        "1. Set `CHATGPT_SESSION_TOKEN` (or `CHATGPT_COOKIES`) in your `.env`.",
        "2. Optionally set `PROXY_API_KEY` to require a bearer token on every request.",
        "3. Point any OpenAI SDK at `" + "http://localhost:" + PORT + "/v1`.",
        "",
        "### Authentication",
        "Send `Authorization: Bearer <key>` where `<key>` is either:",
        "- your configured `PROXY_API_KEY`, or",
        "- a raw ChatGPT Web access token (JWT starting with `ey…`).",
        "",
        "If `PROXY_API_KEY` is not set, the gateway is open to anyone who can reach it.",
      ].join("\n"),
      contact: { name: "ChatGPT-to-API", url: "https://github.com/" },
      license: { name: "ISC" },
    },
    servers: [
      { url: "http://localhost:" + PORT, description: "Local development" },
      { url: "/", description: "Same origin" },
    ],
    tags: [
      { name: "Health", description: "Liveness probe." },
      { name: "Models", description: "OpenAI-compatible model listing." },
      { name: "Chat", description: "Chat Completions — the main endpoint." },
      {
        name: "Responses",
        description:
          "OpenAI Responses API bridge for newer agentic clients (Codex CLI ≥ 0.93). Stateless: send full history in `input`.",
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT or PROXY_API_KEY",
          description:
            "Either the configured `PROXY_API_KEY`, or a raw ChatGPT access token (starts with `ey`).",
        },
      },
      schemas: {
        Error: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                message: { type: "string" },
                type: { type: "string" },
                code: {
                  oneOf: [{ type: "string" }, { type: "integer" }],
                },
              },
            },
          },
          example: {
            error: {
              message: "Invalid or missing Proxy API Key.",
              type: "invalid_request_error",
              code: "unauthorized",
            },
          },
        },
        Ping: {
          type: "object",
          properties: {
            status: { type: "string", example: "ok" },
            time: {
              type: "string",
              format: "date-time",
              example: "2026-05-22T12:34:56.789Z",
            },
          },
        },
        Model: {
          type: "object",
          properties: {
            id: { type: "string", example: "gpt-5-5" },
            object: { type: "string", example: "model" },
            created: { type: "integer", example: 1715644800 },
            owned_by: { type: "string", example: "openai" },
          },
        },
        ModelList: {
          type: "object",
          properties: {
            object: { type: "string", example: "list" },
            data: {
              type: "array",
              items: { $ref: "#/components/schemas/Model" },
            },
          },
        },
        ChatCompletionMessage: {
          type: "object",
          required: ["role"],
          properties: {
            role: {
              type: "string",
              enum: ["system", "user", "assistant", "tool"],
              description: "The author role of this message.",
            },
            content: {
              type: "string",
              nullable: true,
              description:
                "Text content. May be `null` on assistant messages that only carry `tool_calls`.",
            },
            name: {
              type: "string",
              description: "Optional name for the author (rarely used).",
            },
            tool_call_id: {
              type: "string",
              description:
                "Required on `role: \"tool\"` messages — the `id` of the assistant tool call this is a result for.",
            },
            tool_calls: {
              type: "array",
              description:
                "Present on assistant messages that called tools. The gateway translates these into the `<tool_call>` text protocol when echoing back to ChatGPT.",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  type: { type: "string", enum: ["function"] },
                  function: {
                    type: "object",
                    properties: {
                      name: { type: "string" },
                      arguments: {
                        type: "string",
                        description: "JSON-encoded argument object.",
                      },
                    },
                  },
                },
              },
            },
          },
          example: { role: "user", content: "Hello, who are you?" },
        },
        ChatCompletionsRequest: {
          type: "object",
          required: ["messages"],
          properties: {
            model: {
              type: "string",
              description:
                "Model id. Accepts any string; upstream ChatGPT may ignore unknown values and route to its default.",
              enum: SUPPORTED_MODELS,
              example: "gpt-5-5",
            },
            messages: {
              type: "array",
              minItems: 1,
              items: { $ref: "#/components/schemas/ChatCompletionMessage" },
            },
            stream: {
              type: "boolean",
              default: false,
              description:
                "If true, response is `text/event-stream` of OpenAI-style chunks terminated by `data: [DONE]`.",
            },
            temperature: {
              type: "number",
              format: "float",
              minimum: 0,
              maximum: 2,
              description:
                "Accepted for OpenAI compatibility. Not forwarded — ChatGPT Web does not expose this control.",
            },
            top_p: {
              type: "number",
              format: "float",
              minimum: 0,
              maximum: 1,
              description: "Accepted for compatibility; not forwarded.",
            },
            max_tokens: {
              type: "integer",
              minimum: 1,
              description: "Accepted for compatibility; not forwarded.",
            },
            n: {
              type: "integer",
              minimum: 1,
              default: 1,
              description:
                "Accepted for compatibility. Only `n=1` is meaningful — additional choices are not generated.",
            },
            stop: {
              oneOf: [
                { type: "string" },
                { type: "array", items: { type: "string" } },
              ],
              description: "Accepted for compatibility; not forwarded.",
            },
            presence_penalty: {
              type: "number",
              format: "float",
              description: "Accepted for compatibility; not forwarded.",
            },
            frequency_penalty: {
              type: "number",
              format: "float",
              description: "Accepted for compatibility; not forwarded.",
            },
            user: {
              type: "string",
              description: "Accepted for compatibility; not forwarded.",
            },
            tools: {
              type: "array",
              description:
                "Tool definitions. Supports two kinds: **`function`** tools use a prompt-engineered `<tool_call>` protocol (reliable for simple schemas). **`web_search_preview`** triggers ChatGPT's native web search — results come back with URL citation annotations.",
              items: {
                oneOf: [
                  {
                    type: "object",
                    description: "Prompt-engineered function tool.",
                    properties: {
                      type: { type: "string", enum: ["function"] },
                      function: {
                        type: "object",
                        properties: {
                          name: { type: "string" },
                          description: { type: "string" },
                          parameters: { type: "object", description: "JSON Schema for the arguments." },
                        },
                        required: ["name"],
                      },
                    },
                  },
                  {
                    type: "object",
                    description: "Native web search tool — uses ChatGPT's built-in search. No prompt engineering needed.",
                    properties: {
                      type: { type: "string", enum: ["web_search_preview", "web_search"] },
                      search_context_size: {
                        type: "string",
                        enum: ["low", "medium", "high"],
                        description: "Hint for search depth (accepted for compatibility; not all levels may be honored upstream).",
                      },
                    },
                  },
                ],
              },
            },
            tool_choice: {
              description:
                "`auto` (default), `none` (disable tools entirely), `required`/`any` (force at least one tool call), or `{type:'function', function:{name:'…'}}` to force a specific tool.",
              oneOf: [
                { type: "string", enum: ["auto", "none", "required", "any"] },
                {
                  type: "object",
                  properties: {
                    type: { type: "string", enum: ["function"] },
                    function: {
                      type: "object",
                      properties: { name: { type: "string" } },
                      required: ["name"],
                    },
                  },
                },
              ],
            },
          },
          additionalProperties: true,
          example: {
            model: "gpt-5-5",
            stream: false,
            messages: [
              { role: "system", content: "You are a helpful assistant." },
              { role: "user", content: "Say hello in one sentence." },
            ],
          },
        },
        ChatCompletionChoice: {
          type: "object",
          properties: {
            index: { type: "integer", example: 0 },
            message: { $ref: "#/components/schemas/ChatCompletionMessage" },
            finish_reason: {
              type: "string",
              enum: ["stop", "length", "content_filter", "tool_calls", null],
              example: "stop",
            },
          },
        },
        ChatCompletionUsage: {
          type: "object",
          description:
            "Always returned as zeros — ChatGPT Web does not expose token counts.",
          properties: {
            prompt_tokens: { type: "integer", example: 0 },
            completion_tokens: { type: "integer", example: 0 },
            total_tokens: { type: "integer", example: 0 },
          },
        },
        ChatCompletionResponse: {
          type: "object",
          properties: {
            id: { type: "string", example: "chatcmpl-abc123..." },
            object: { type: "string", example: "chat.completion" },
            created: { type: "integer", example: 1716381296 },
            model: { type: "string", example: "gpt-5-5" },
            choices: {
              type: "array",
              items: { $ref: "#/components/schemas/ChatCompletionChoice" },
            },
            usage: { $ref: "#/components/schemas/ChatCompletionUsage" },
          },
        },
        ChatCompletionChunkDelta: {
          type: "object",
          properties: {
            role: { type: "string", example: "assistant" },
            content: { type: "string", example: " world" },
          },
        },
        ChatCompletionChunk: {
          type: "object",
          properties: {
            id: { type: "string", example: "chatcmpl-abc123..." },
            object: { type: "string", example: "chat.completion.chunk" },
            created: { type: "integer", example: 1716381296 },
            model: { type: "string", example: "gpt-5-5" },
            choices: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  index: { type: "integer", example: 0 },
                  delta: {
                    $ref: "#/components/schemas/ChatCompletionChunkDelta",
                  },
                  finish_reason: {
                    type: "string",
                    nullable: true,
                    example: null,
                  },
                },
              },
            },
          },
        },
      },
      responses: {
        Unauthorized: {
          description: "Missing or invalid bearer credential.",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Error" },
            },
          },
        },
        BadRequest: {
          description: "Malformed request body.",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Error" },
            },
          },
        },
        ServerError: {
          description: "Unexpected upstream or proxy error.",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Error" },
            },
          },
        },
      },
    },
    paths: {
      "/ping": {
        get: {
          tags: ["Health"],
          summary: "Liveness probe",
          description:
            "Returns a static OK payload. Does not contact ChatGPT — safe for health checks and load balancers.",
          security: [],
          responses: {
            200: {
              description: "Gateway is up.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Ping" },
                  example: { status: "ok", time: "2026-05-22T12:34:56.789Z" },
                },
              },
            },
          },
        },
      },
      "/v1/models": {
        get: {
          tags: ["Models"],
          summary: "List available models",
          description:
            "Returns a static OpenAI-style model list reflecting the slugs accepted by this gateway. " +
            "Unknown slugs sent to `/v1/chat/completions` are still forwarded — ChatGPT Web may route to its default.",
          security: [],
          responses: {
            200: {
              description: "Static list of OpenAI-style model ids.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ModelList" },
                },
              },
            },
          },
        },
      },
      "/v1/chat/completions": {
        post: {
          tags: ["Chat"],
          summary: "Create a chat completion",
          description: [
            "OpenAI-compatible Chat Completions endpoint.",
            "",
            "- When `stream` is omitted or `false`, returns a single JSON `ChatCompletionResponse`.",
            "- When `stream` is `true`, returns `text/event-stream` of `ChatCompletionChunk` payloads, terminated by `data: [DONE]`.",
            "",
            "**Note:** OpenAI sampling controls (`temperature`, `top_p`, `max_tokens`, …) are accepted for compatibility but not forwarded — ChatGPT Web does not expose them.",
          ].join("\n"),
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ChatCompletionsRequest" },
                examples: {
                  simple: {
                    summary: "Single user message",
                    value: {
                      model: "gpt-5-5",
                      messages: [{ role: "user", content: "Hello!" }],
                    },
                  },
                  streaming: {
                    summary: "Streaming with system prompt",
                    value: {
                      model: "gpt-5-5",
                      stream: true,
                      messages: [
                        {
                          role: "system",
                          content: "You are a terse assistant.",
                        },
                        { role: "user", content: "Count to three." },
                      ],
                    },
                  },
                  tools: {
                    summary: "Function calling (prompt-engineered)",
                    value: {
                      model: "gpt-5-5",
                      messages: [
                        { role: "user", content: "List files in /tmp." },
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
                                  items: { type: "string" },
                                },
                              },
                              required: ["command"],
                            },
                          },
                        },
                      ],
                      tool_choice: "auto",
                    },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description:
                "Chat completion. JSON body for non-streaming requests; SSE stream for `stream: true`.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ChatCompletionResponse" },
                },
                "text/event-stream": {
                  schema: { $ref: "#/components/schemas/ChatCompletionChunk" },
                  example:
                    'data: {"id":"chatcmpl-abc","object":"chat.completion.chunk","created":1716381296,"model":"gpt-5-5","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}\n\n' +
                    "data: [DONE]\n\n",
                },
              },
            },
            400: { $ref: "#/components/responses/BadRequest" },
            401: { $ref: "#/components/responses/Unauthorized" },
            500: { $ref: "#/components/responses/ServerError" },
          },
        },
      },
      "/v1/responses": {
        post: {
          tags: ["Responses"],
          summary: "Create a response (OpenAI Responses API bridge)",
          description: [
            "Stateless Responses-API bridge. Translates `input` items + `instructions` into Chat Completions internally, runs the same prompt-engineered tool protocol, and returns a Responses-shape result.",
            "",
            "**Required by Codex CLI ≥ 0.93** (older `wire_api = \"chat\"` was removed in Feb 2026).",
            "",
            "**Not supported:** `previous_response_id`, `conversation`, hosted tools (`web_search`, `file_search`, `computer_use`, MCP). Send full history in `input`.",
          ].join("\n"),
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    model: { type: "string", example: "gpt-5-5" },
                    instructions: {
                      type: "string",
                      description: "Prepended as a system message.",
                    },
                    input: {
                      oneOf: [
                        { type: "string" },
                        {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              type: {
                                type: "string",
                                enum: ["message", "function_call", "function_call_output", "reasoning"],
                              },
                            },
                          },
                        },
                      ],
                    },
                    tools: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          type: { type: "string", enum: ["function"] },
                          name: { type: "string" },
                          description: { type: "string" },
                          parameters: { type: "object" },
                        },
                      },
                    },
                    tool_choice: {},
                    stream: { type: "boolean", default: false },
                  },
                },
                example: {
                  model: "gpt-5-5",
                  instructions: "You are a helpful coding assistant.",
                  input: [{ type: "message", role: "user", content: "Hello!" }],
                },
              },
            },
          },
          responses: {
            200: {
              description: "Response. JSON body, or SSE event stream if `stream: true`.",
            },
            400: { $ref: "#/components/responses/BadRequest" },
            401: { $ref: "#/components/responses/Unauthorized" },
            500: { $ref: "#/components/responses/ServerError" },
          },
        },
      },
    },
  },
  apis: [],
});

app.get("/openapi.json", (req, res) => res.json(openApiSpec));
app.use(
  "/docs",
  swaggerUi.serve,
  swaggerUi.setup(openApiSpec, {
    customSiteTitle: "ChatGPT-to-API · Docs",
    customCss:
      ".swagger-ui .topbar { display: none } .swagger-ui .info { margin: 24px 0 } .swagger-ui .info .title { font-size: 28px }",
    swaggerOptions: {
      docExpansion: "list",
      defaultModelsExpandDepth: 1,
      defaultModelExpandDepth: 2,
      tryItOutEnabled: true,
      persistAuthorization: true,
      displayRequestDuration: true,
      filter: true,
    },
  })
);

/**
 * Builds a system-prompt preamble that teaches the model the <tool_call> output
 * protocol. Returns "" when no tools are supplied.
 */
function buildToolSystemPrompt(tools, toolChoice) {
  if (!tools || !Array.isArray(tools) || tools.length === 0) return "";

  const fns = tools
    .filter((t) => t && t.type === "function" && t.function)
    .map((t) => {
      const f = t.function;
      const params = f.parameters ? JSON.stringify(f.parameters) : "{}";
      return `- ${f.name}: ${f.description || ""}\n  parameters: ${params}`;
    })
    .join("\n");

  let choiceHint = "";
  if (toolChoice === "required" || toolChoice === "any") {
    choiceHint =
      "\nYou MUST call at least one tool in your reply. Do not answer in plain text.";
  } else if (toolChoice === "none") {
    return "";
  } else if (
    toolChoice &&
    typeof toolChoice === "object" &&
    toolChoice.function?.name
  ) {
    choiceHint = `\nYou MUST call the tool \`${toolChoice.function.name}\` in your reply.`;
  }

  return [
    "You have access to function tools. To invoke a tool, emit a block of EXACTLY this form (the parser is strict):",
    "<tool_call>",
    '{"name": "<tool_name>", "arguments": <json_object>}',
    "</tool_call>",
    "",
    "Rules:",
    "- One tool call per <tool_call>...</tool_call> block. Multiple blocks per reply are allowed (parallel calls).",
    "- `arguments` MUST be a JSON object literal, not a stringified JSON.",
    "- Tool names MUST match the Available tools list exactly. Do not use hosted/internal tool names such as `file_search.msearch`, `container.exec`, or `functions.exec_command`; use the local tools listed below.",
    "- When you need to run a shell command and `bash` is available, call `bash` with a `command` argument. Do not call `container.exec`.",
    "- When the user asks to list, inspect, search, or read files, call an available file tool immediately. Do not reply with prose such as \"I'll list the files\" without a tool call.",
    "- No code fences around the block. No `<call>`, `<function_call>`, or other aliases — use `<tool_call>` literally.",
    "- After a tool result arrives (as `<tool_result id=\"...\">...</tool_result>` in a user turn), continue the conversation or emit more tool calls.",
    "- Only emit prose outside `<tool_call>` blocks when you are giving the final answer for this turn.",
    "",
    "CORRECT:",
    "<tool_call>",
    '{"name": "search_files", "arguments": {"pattern": "*.py", "path": "/src"}}',
    "</tool_call>",
    "",
    "WRONG (do not do these):",
    "  ```json",
    '  {"name": "search_files", "arguments": {...}}    ← bare fenced JSON, missing <tool_call> tags',
    "  ```",
    '  <tool_call>{"name":"search_files","arguments":"{\\"pattern\\":\\"*.py\\"}"}</tool_call>    ← arguments stringified instead of an object',
    '  I will call search_files({"pattern":"*.py"})    ← prose call instead of the protocol',
    "",
    "Available tools:",
    fns,
    choiceHint,
  ].join("\n");
}

/**
 * Renders an OpenAI-format message (which may carry tool_calls or be a tool
 * result) into the plain-text representation we feed to ChatGPT Web.
 */
function renderMessageForPrompt(msg) {
  const role = msg.role.charAt(0).toUpperCase() + msg.role.slice(1);

  if (msg.role === "tool") {
    const id = msg.tool_call_id || "unknown";
    const body =
      typeof msg.content === "string"
        ? msg.content
        : JSON.stringify(msg.content ?? "");
    return `User: <tool_result id="${id}">${body}</tool_result>`;
  }

  if (msg.role === "assistant" && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
    const blocks = msg.tool_calls
      .map((tc) => {
        const name = tc.function?.name || tc.name || "unknown";
        let args = tc.function?.arguments ?? tc.arguments ?? "{}";
        if (typeof args === "string") {
          try { args = JSON.parse(args); } catch { /* keep as raw string */ }
        }
        const argsJson = typeof args === "string" ? args : JSON.stringify(args);
        return `<tool_call>\n{"id": "${tc.id || ""}", "name": "${name}", "arguments": ${argsJson}}\n</tool_call>`;
      })
      .join("\n");
    const prose = msg.content ? `${msg.content}\n` : "";
    return `${role}: ${prose}${blocks}`;
  }

  const content =
    typeof msg.content === "string"
      ? msg.content
      : Array.isArray(msg.content)
        ? msg.content.map((p) => p?.text || "").join("")
        : JSON.stringify(msg.content ?? "");
  return `${role}: ${content}`;
}

/**
 * Formats a stateless list of OpenAI-style messages into a single, cohesive
 * prompt suitable for ChatGPT's single-node conversation format.
 *
 * When `tools` is provided, prepends a system preamble describing the
 * <tool_call> protocol and rewrites assistant tool_calls / tool results into
 * the same wire format so the conversation stays coherent.
 */
function formatMessages(messages, tools, toolChoice) {
  if (!messages || messages.length === 0) return "";

  const toolPreamble = buildToolSystemPrompt(tools, toolChoice);
  const hasTools = toolPreamble.length > 0;

  if (messages.length === 1 && !hasTools) {
    return typeof messages[0].content === "string"
      ? messages[0].content
      : renderMessageForPrompt(messages[0]).replace(/^[A-Z][a-z]+: /, "");
  }

  let formatted = "";
  if (hasTools) formatted += `[Tool Protocol]\n${toolPreamble}\n\n`;

  for (let i = 0; i < messages.length; i++) {
    const rendered = renderMessageForPrompt(messages[i]);
    if (i === messages.length - 1) {
      formatted += `\n[Current Instruction]\n${rendered}`;
    } else {
      if (i === 0 && !hasTools) formatted += `[Conversation Context]\n`;
      else if (i === 0) formatted += `[Conversation Context]\n`;
      formatted += `${rendered}\n`;
    }
  }
  return formatted;
}

/**
 * When the client sends a tools[] array, instant models drift out of the
 * <tool_call> format on long agentic loops. Thinking variants plan in CoT
 * before emitting, so they hold the protocol better, but they are slower for
 * agent loops. Opt into automatic upgrades with TOOL_FORCE_THINKING=true.
 */
function enforceThinkingForTools(requestedModel, hasTools) {
  if (!hasTools) return requestedModel;
  if (process.env.TOOL_FORCE_THINKING !== "true") return requestedModel;
  const m = (requestedModel || "").toLowerCase();
  // Already a thinking/reasoning model — leave it alone.
  if (m.includes("thinking") || m.includes("reasoning") || m === "o3" || m === "o4" || m.startsWith("o1")) {
    return requestedModel;
  }
  // Auto / instant / unspecified → upgrade.
  return "gpt-5-5-thinking";
}

/**
 * Scans assistant text for tool-call blocks and extracts them as OpenAI-format
 * tool_calls. Tolerant of common malformations:
 *   - alias openers/closers (<tool_call>, <call>, <function_call>, <tool>)
 *   - unclosed final block (we parse up to end-of-text)
 *   - code fences inside the block (```json ... ```)
 *   - leading/trailing prose like "Calling tool: <tool_call>..."
 *   - field aliases: name|function|tool, arguments|args|input|parameters
 *   - single-quoted JSON, trailing commas, unquoted keys (best-effort repair)
 *   - bare fenced JSON code blocks that look like a tool call, when no XML tag exists
 *
 * Returns { cleanedText, toolCalls }. cleanedText is the original text with all
 * recognized tool-call blocks removed.
 */
function repairLooseJson(s) {
  // Best-effort: strip code fences, trailing commas, single quotes around keys/values.
  let t = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  // Drop trailing commas before } or ]
  t = t.replace(/,(\s*[}\]])/g, "$1");
  // Strip JavaScript-style comments (// and /* */)
  t = t.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  // Single-quoted "strings" to double-quoted (only for keys / simple values; risky in general
  // but the model rarely emits real apostrophes inside JSON values).
  if (!t.includes('"') && t.includes("'")) {
    t = t.replace(/'/g, '"');
  }
  // Attempt to quote unquoted keys:  { foo: "bar" }  →  { "foo": "bar" }
  t = t.replace(/([{,]\s*)([a-zA-Z_]\w*)\s*:/g, '$1"$2":');
  // Fix escaped newlines inside string values that should be \\n not literal newline
  t = t.replace(/(?<=":?\s*"[^"]*)\n/g, "\\n");
  return t;
}

function tryParseToolCallBody(raw) {
  if (!raw) return null;
  const candidates = [raw, repairLooseJson(raw)];
  for (const cand of candidates) {
    try { return JSON.parse(cand); } catch { /* try next */ }
  }
  // Try extracting balanced {...} — find the outermost balanced braces
  const repaired = repairLooseJson(raw);
  for (const src of [repaired, raw]) {
    const start = src.indexOf("{");
    if (start === -1) continue;
    let depth = 0;
    let end = -1;
    for (let i = start; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") {
        depth--;
        if (depth === 0) { end = i + 1; break; }
      }
    }
    if (end > start) {
      const balanced = src.slice(start, end);
      try { return JSON.parse(balanced); } catch {}
      try { return JSON.parse(repairLooseJson(balanced)); } catch {}
    }
  }
  return null;
}

function buildToolCall(parsed, idx) {
  if (!parsed || typeof parsed !== "object") return null;
  let name = parsed.name || parsed.function || parsed.tool || parsed.tool_name;
  if (!name && Array.isArray(parsed.queries) && (parsed.source_filter || parsed.intent)) {
    name = "file_search.msearch";
  }
  if (!name || typeof name !== "string") return null;
  const args = parsed.arguments ?? parsed.args ?? parsed.input ?? parsed.parameters ?? (name === "file_search.msearch" ? parsed : {});
  return {
    id: parsed.id || `call_${Date.now().toString(36)}_${idx}`,
    type: "function",
    function: {
      name,
      arguments: typeof args === "string" ? args : JSON.stringify(args),
    },
  };
}

function parseToolArguments(args) {
  if (!args || typeof args !== "string") return args && typeof args === "object" ? args : {};
  try {
    const parsed = JSON.parse(args);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function stringifyToolArguments(args) {
  return typeof args === "string" ? args : JSON.stringify(args || {});
}

function shellQuote(value) {
  const s = String(value || "");
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function commandArrayToString(parts) {
  return parts.map((part) => shellQuote(part)).join(" ");
}

function normalizeUnavailableToolCall(toolCall, allowedToolNames) {
  if (!toolCall || !allowedToolNames || allowedToolNames.has(toolCall.function.name)) return toolCall;

  const name = toolCall.function.name;
  const args = parseToolArguments(toolCall.function.arguments);

  if (
    ["container.exec", "functions.exec_command", "exec_command", "shell"].includes(name) &&
    allowedToolNames.has("bash")
  ) {
    const rawCommand =
      args.command ??
      args.cmd ??
      args.commands ??
      args.input ??
      args.script ??
      "";
    const command = Array.isArray(rawCommand)
      ? commandArrayToString(rawCommand)
      : String(rawCommand || "");
    const workdir = args.workdir || args.cwd;
    const fullCommand = workdir && command
      ? `cd ${shellQuote(workdir)} && ${command}`
      : command;

    return {
      ...toolCall,
      function: {
        name: "bash",
        arguments: stringifyToolArguments({ command: fullCommand }),
      },
    };
  }

  if (name === "file_search.msearch") {
    const rawQuery = Array.isArray(args.queries)
      ? args.queries.find((q) => typeof q === "string" && q.trim())
      : typeof args.query === "string"
        ? args.query
        : "";
    const query = (rawQuery || "").trim();
    const path = args.path || args.directory || args.cwd;

    if (allowedToolNames.has("glob")) {
      const looksLikeGlob = /[*?[\]{}]/.test(query);
      const asksForListing = !query || /\b(list|show|all files?|files|filenames?|directory|tree)\b/i.test(query);
      const pattern = looksLikeGlob ? query : asksForListing ? "**/*" : `**/*${query.replace(/\s+/g, "*")}*`;
      return {
        ...toolCall,
        function: {
          name: "glob",
          arguments: stringifyToolArguments({
            pattern,
            ...(path ? { path } : {}),
          }),
        },
      };
    }

    if (allowedToolNames.has("grep") && query) {
      return {
        ...toolCall,
        function: {
          name: "grep",
          arguments: stringifyToolArguments({
            pattern: query,
            ...(path ? { path } : {}),
          }),
        },
      };
    }
  }

  return toolCall;
}

function inferProseFileToolCall(text, idx, allowedToolNames) {
  if (!text || !allowedToolNames || !allowedToolNames.has("glob")) return null;

  const saysWillList =
    /\b(?:i\s*(?:will|'ll|’ll)|i\s+am\s+going\s+to|i'm\s+going\s+to|let\s+me)\s+(?:now\s+)?(?:list|show|inspect|scan|find)\b/i.test(text);
  const fileIntent = /\b(?:all\s+files|workspace\s+files|files?|file\s+paths?|directory|directories|tree)\b/i.test(text);
  if (!saysWillList || !fileIntent) return null;

  const pathMatch = text.match(/\bfrom\s+((?:\/|~\/)[^\s,;!?)\]}"'`<>]+)/i);
  const path = pathMatch ? pathMatch[1].replace(/[.:]+$/g, "") : undefined;

  return {
    id: `call_${Date.now().toString(36)}_${idx}`,
    type: "function",
    function: {
      name: "glob",
      arguments: stringifyToolArguments({
        pattern: "**/*",
        ...(path ? { path } : {}),
      }),
    },
  };
}

function shouldTryEarlyToolExtraction(text) {
  const t = (text || "").trim();
  if (!t) return false;
  if (/<\/(?:tool_call|function_call|call|tool)>/i.test(t)) return true;
  if (/```/.test(t) && /```\s*$/i.test(t)) return true;
  if (/^\{[\s\S]*\}$/.test(t) && /"(?:name|function|tool|tool_name|queries)"\s*:/.test(t)) return true;
  if (/^[a-zA-Z0-9_.]+\s*\(\s*\{[\s\S]*\}\s*\)\s*$/.test(t)) return true;
  if (/<([a-zA-Z0-9_.-]+)>[\s\S]*<\/\1>\s*$/i.test(t)) return true;
  return false;
}

function emitChatToolCalls(safeWrite, completionId, model, toolCalls) {
  safeWrite(`data: ${JSON.stringify({
    id: completionId,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      delta: { role: "assistant", tool_calls: toolCalls.map((tc, i) => ({ index: i, ...tc })) },
      finish_reason: null
    }]
  })}\n\n`);
  safeWrite(`data: ${JSON.stringify({
    id: completionId,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }]
  })}\n\n`);
}

function allowedToolNameSet(tools) {
  return new Set((tools || []).map(t => t.function?.name).filter(Boolean));
}

function buildNormalizedToolCall(id, name, args, allowedToolNames) {
  const raw = {
    id,
    type: "function",
    function: {
      name,
      arguments: typeof args === "string" ? args : JSON.stringify(args ?? {}),
    },
  };
  return normalizeUnavailableToolCall(raw, allowedToolNames);
}

function extractToolCalls(text, allowedToolNames) {
  if (!text || typeof text !== "string") return { cleanedText: text || "", toolCalls: [] };

  const toolCalls = [];
  // Aliases the model is observed to emit. Order matters: match the most specific first.
  const openers = ["<tool_call>", "<function_call>", "<call>", "<tool>"];
  const closers = ["</tool_call>", "</function_call>", "</call>", "</tool>"];

  const spans = []; // [{start, end}] of recognized blocks, to strip later
  let idx = 0;

  // Pass 1: find every opener and try to pair with the nearest closer (any alias).
  let cursor = 0;
  while (cursor < text.length) {
    let bestOpenAt = -1;
    let bestOpenLen = 0;
    for (const o of openers) {
      const at = text.indexOf(o, cursor);
      if (at !== -1 && (bestOpenAt === -1 || at < bestOpenAt)) {
        bestOpenAt = at;
        bestOpenLen = o.length;
      }
    }
    if (bestOpenAt === -1) break;

    const bodyStart = bestOpenAt + bestOpenLen;
    let bestCloseAt = -1;
    let bestCloseLen = 0;
    for (const c of closers) {
      const at = text.indexOf(c, bodyStart);
      if (at !== -1 && (bestCloseAt === -1 || at < bestCloseAt)) {
        bestCloseAt = at;
        bestCloseLen = c.length;
      }
    }

    let bodyEnd, blockEnd;
    if (bestCloseAt === -1) {
      // Unclosed final block — parse whatever follows up to end of text.
      bodyEnd = text.length;
      blockEnd = text.length;
    } else {
      bodyEnd = bestCloseAt;
      blockEnd = bestCloseAt + bestCloseLen;
    }

    const body = text.slice(bodyStart, bodyEnd).trim();
    const parsed = tryParseToolCallBody(body);
    const built = normalizeUnavailableToolCall(buildToolCall(parsed, idx), allowedToolNames);
    if (built) {
      if (allowedToolNames && !allowedToolNames.has(built.function.name)) {
        // Model hallucinated a tool name not in the client's registry — skip it.
        console.warn(`[Proxy] Dropping tool call '${built.function.name}' — not in client's tools list.`);
        cursor = blockEnd;
        continue;
      }
      toolCalls.push(built);
      idx++;
      spans.push({ start: bestOpenAt, end: blockEnd });
    }
    cursor = blockEnd;
  }

  // Pass 2: if no XML-tagged blocks were found at all, look for a bare fenced JSON
  // block that has a "name" and "arguments" — model sometimes drops the tags entirely.
  if (toolCalls.length === 0) {
    const fenceRe = /```(?:json)?\s*([\s\S]*?)\s*```/g;
    let m;
    while ((m = fenceRe.exec(text)) !== null) {
      const parsed = tryParseToolCallBody(m[1]);
      const built = normalizeUnavailableToolCall(buildToolCall(parsed, idx), allowedToolNames);
      if (built) {
        if (allowedToolNames && !allowedToolNames.has(built.function.name)) {
          console.warn(`[Proxy] Dropping fenced tool call '${built.function.name}' — not in client's tools list.`);
          continue;
        }
        toolCalls.push(built);
        idx++;
        spans.push({ start: m.index, end: m.index + m[0].length });
      }
    }
  }

  // Pass 3: if still no tool calls found, parse a bare JSON object. Some models
  // emit hosted file-search payloads like {"queries":[""],"intent":"nav"} as text.
  if (toolCalls.length === 0) {
    const parsed = tryParseToolCallBody(text.trim());
    const built = normalizeUnavailableToolCall(buildToolCall(parsed, idx), allowedToolNames);
    if (built) {
      if (allowedToolNames && !allowedToolNames.has(built.function.name)) {
        console.warn(`[Proxy] Dropping bare JSON tool call '${built.function.name}' — not in client's tools list.`);
      } else {
        toolCalls.push(built);
        idx++;
        spans.push({ start: 0, end: text.length });
      }
    }
  }

  // Pass 4: if still no tool calls found, look for a bare "tool_name(json_arguments)" pattern.
  if (toolCalls.length === 0) {
    const fnRe = /([a-zA-Z0-9_\.]+)\s*\(\s*(\{[\s\S]*?\})\s*\)/g;
    let m;
    while ((m = fnRe.exec(text)) !== null) {
      const name = m[1];
      const body = m[2];
      const parsed = tryParseToolCallBody(body);
      if (parsed) {
        const built = buildToolCall({ name, arguments: parsed }, idx);
        const normalized = normalizeUnavailableToolCall(built, allowedToolNames);
        if (normalized) {
          if (allowedToolNames && !allowedToolNames.has(normalized.function.name)) {
            console.warn(`[Proxy] Dropping bare fn call '${normalized.function.name}' — not in client's tools list.`);
            continue;
          }
          toolCalls.push(normalized);
          idx++;
          spans.push({ start: m.index, end: m.index + m[0].length });
        }
      }
    }
  }

  // Pass 5: if still no tool calls found, look for custom-named XML tags like <tool_name>json_arguments</tool_name>.
  if (toolCalls.length === 0) {
    const customTagRe = /<([a-zA-Z0-9_\-\.]+)>([\s\S]*?)<\/(\1)>/g;
    const IGNORED_TAGS = new Set([
      "p", "div", "span", "code", "pre", "a", "h1", "h2", "h3", "h4", "h5", "h6",
      "ul", "ol", "li", "html", "body", "head", "style", "script", "table", "tr",
      "td", "th", "thead", "tbody", "em", "strong", "b", "i", "u", "br", "hr", "img",
      "input", "button", "select", "option", "textarea", "form", "label", "meta", "link",
      "tool_call", "function_call", "call", "tool", "tool_result"
    ]);
    let m;
    while ((m = customTagRe.exec(text)) !== null) {
      const name = m[1];
      if (IGNORED_TAGS.has(name.toLowerCase())) continue;
      const body = m[2];
      const parsed = tryParseToolCallBody(body);
      if (parsed) {
        const built = buildToolCall({ name, arguments: parsed }, idx);
        const normalized = normalizeUnavailableToolCall(built, allowedToolNames);
        if (normalized) {
          if (allowedToolNames && !allowedToolNames.has(normalized.function.name)) {
            console.warn(`[Proxy] Dropping custom-tag tool call '${normalized.function.name}' — not in client's tools list.`);
            continue;
          }
          toolCalls.push(normalized);
          idx++;
          spans.push({ start: m.index, end: m.index + m[0].length });
        }
      }
    }
  }

  // Pass 6: final narrow fallback for prose-only "I'll list files from /path"
  // responses. This repairs a common no-op agent turn without guessing broadly.
  if (toolCalls.length === 0) {
    const built = inferProseFileToolCall(text, idx, allowedToolNames);
    if (built) {
      toolCalls.push(built);
      spans.push({ start: 0, end: text.length });
    }
  }

  // Strip recognized spans from cleanedText (in reverse so indices stay valid).
  let cleanedText = text;
  for (const { start, end } of spans.sort((a, b) => b.start - a.start)) {
    cleanedText = cleanedText.slice(0, start) + cleanedText.slice(end);
  }
  return { cleanedText: cleanedText.trim(), toolCalls };
}

/**
 * Detects whether the caller wants native web search (via `web_search_preview`
 * or `web_search` tool type). If so, those entries should NOT be injected
 * into the prompt-engineered tool protocol.
 */
function hasNativeSearchTool(tools) {
  if (!tools || !Array.isArray(tools)) return false;
  return tools.some(
    (t) =>
      t &&
      (t.type === "web_search_preview" ||
        t.type === "web_search" ||
        (t.type === "function" && t.function?.name === "web_search"))
  );
}

/**
 * Filters out native/hosted tool types that the proxy should NOT inject into
 * the prompt-engineered `<tool_call>` protocol. Returns only function-type
 * tools meant for prompt engineering.
 */
function filterPromptEngineeredTools(tools) {
  if (!tools || !Array.isArray(tools)) return [];
  return tools.filter(
    (t) =>
      t &&
      t.type === "function" &&
      t.function &&
      t.function.name !== "web_search"
  );
}

/**
 * Extracts OpenAI-compatible annotations (URL citations) from ChatGPT's
 * native tool messages. The upstream SSE stream carries these in
 * `message.metadata.cite_metadata` or `message.metadata.search_result_groups`.
 *
 * Returns an array of `{ type, url, title, start_index, end_index }` objects.
 */
function extractAnnotations(metadata) {
  const annotations = [];
  if (!metadata) return annotations;

  // cite_metadata.citations is the most common shape
  const citations =
    metadata.cite_metadata?.citations ||
    metadata.citations ||
    [];
  for (const cite of citations) {
    if (cite.url) {
      annotations.push({
        type: "url_citation",
        url: cite.url,
        title: cite.title || cite.snippet || "",
        start_index: cite.start_ix ?? 0,
        end_index: cite.end_ix ?? 0,
      });
    }
  }

  // search_result_groups is another shape sometimes used
  const groups = metadata.search_result_groups || [];
  for (const group of groups) {
    const entries = group.search_results || group.entries || [];
    for (const entry of entries) {
      if (entry.url && !annotations.some((a) => a.url === entry.url)) {
        annotations.push({
          type: "url_citation",
          url: entry.url,
          title: entry.title || entry.snippet || "",
          start_index: 0,
          end_index: 0,
        });
      }
    }
  }

  return annotations;
}

/**
 * Processes a parsed SSE message from the ChatGPT backend and categorizes it.
 * Returns { type, text, metadata, authorName } where type is one of:
 *   - 'assistant'  — normal assistant text
 *   - 'tool'       — native tool output (browser, python, etc.)
 *   - 'thinking'   — model reasoning/thinking
 *   - 'system'     — system-level message
 *   - null         — not a message we care about
 */
function categorizeMessage(parsed) {
  const message = parsed?.message;
  if (!message || !message.author) return null;

  const role = message.author.role;
  const authorName = message.author.name || "";
  const contentParts = message.content?.parts || [];
  const text = contentParts[0] || "";
  const metadata = message.metadata || {};
  const recipient = message.recipient || "all";

  if (role === "assistant") {
    return { type: "assistant", text, metadata, authorName, recipient };
  }
  if (role === "tool") {
    return { type: "tool", text, metadata, authorName, recipient };
  }
  if (role === "system") {
    return { type: "system", text, metadata, authorName, recipient };
  }
  return null;
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

// ── Sentinel requirements cache ──────────────────────────────────────────────
// Caches the sentinel token + PoW challenge for a short TTL so rapid back-to-back
// requests (common in agentic tool loops) skip the extra round-trip.
let _sentinelCache = null; // { data, expiresAt }
const SENTINEL_TTL_MS = Number(process.env.SENTINEL_CACHE_TTL_MS) || 25_000; // 25 s default

async function _fetchChatRequirements(accessToken, cookieHeader) {
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
    console.error('[Proxy] Sentinel requirements fetch error', resp.status, errText.slice(0, 800).replace(/\s+/g, ' '));
    throw new Error(`Sentinel requirements fetch failed: ${resp.status}`);
  }
  return resp.json();
}

async function getChatRequirements(accessToken, cookieHeader) {
  // Return cached result if still fresh
  if (_sentinelCache && Date.now() < _sentinelCache.expiresAt) {
    console.log('[Proxy] Sentinel requirements (cached)');
    const data = _sentinelCache.data;
    // Invalidate cache so the NEXT request will fetch fresh (single-use per token)
    _sentinelCache = null;
    // Pre-fetch the next one in the background so it's ready
    _fetchChatRequirements(accessToken, cookieHeader)
      .then(d => {
        _sentinelCache = { data: d, expiresAt: Date.now() + SENTINEL_TTL_MS };
      })
      .catch(e => console.warn('[Proxy] Background sentinel pre-fetch failed:', e.message));
    return data;
  }

  console.log('[Proxy] Fetching sentinel chat requirements...');
  const data = await _fetchChatRequirements(accessToken, cookieHeader);
  console.log('[Proxy] Sentinel requirements received:', JSON.stringify({
    token: data.token ? data.token.slice(0, 20) + '...' : null,
    proofofwork: data.proofofwork
  }));
  // Pre-fetch the next one in the background
  _fetchChatRequirements(accessToken, cookieHeader)
    .then(d => {
      _sentinelCache = { data: d, expiresAt: Date.now() + SENTINEL_TTL_MS };
    })
    .catch(e => console.warn('[Proxy] Background sentinel pre-fetch failed:', e.message));
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

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    name: "chatgpt-to-api",
    api_base: "/v1",
    endpoints: {
      models: "/v1/models",
      chat_completions: "/v1/chat/completions",
      responses: "/v1/responses",
      docs: "/docs",
    },
  });
});

app.get("/v1", (req, res) => {
  res.json({
    status: "ok",
    api_base: "/v1",
    endpoints: {
      models: "/v1/models",
      chat_completions: "/v1/chat/completions",
      responses: "/v1/responses",
    },
  });
});

// Models Endpoint (for OpenAI client compatibility)
async function modelsHandler(req, res) {
  let models = SUPPORTED_MODELS;
  try {
    const auth = await authenticateRequest(req);
    if (auth.authorized && auth.source === "db" && auth.key) {
      if (auth.key.enforced_model) {
        models = [auth.key.enforced_model];
      } else if (Array.isArray(auth.key.allowed_models) && auth.key.allowed_models.length > 0) {
        models = auth.key.allowed_models;
      }
    }
  } catch (_) {
    // Fall through with the full list if anything goes sideways.
  }
  res.json({
    object: "list",
    data: models.map((id) => ({
      id,
      object: "model",
      created: 1715644800,
      owned_by: "openai",
    })),
  });
}

app.get("/v1/models", modelsHandler);
app.get("/models", modelsHandler);

// Chat Completions Endpoint
async function chatCompletionsHandler(req, res) {
  installMeterHook(req, res);

  // 1. Authenticate Request
  const auth = await authenticateRequest(req);
  if (!auth.authorized) {
    req._meter.errorCode = "unauthorized";
    return res.status(401).json({
      error: {
        message: "Invalid or missing API key.",
        type: "invalid_request_error",
        code: "unauthorized",
      },
    });
  }
  const clientToken = auth.clientToken;
  if (auth.source === "db" && auth.key) {
    req._meter.keyId = auth.key.id;
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
  const { messages, model, stream, tools, tool_choice } = req.body;

  if (!messages || !Array.isArray(messages)) {
    req._meter.errorCode = "bad_request";
    return res.status(400).json({
      error: {
        message: "Missing 'messages' array in request body.",
        type: "invalid_request_error",
        code: "bad_request"
      }
    });
  }

  // Separate native tools (web_search_preview etc.) from prompt-engineered function tools.
  const wantsNativeSearch = hasNativeSearchTool(tools);
  const promptEngineeredTools = filterPromptEngineeredTools(tools);
  const hasPromptTools = promptEngineeredTools.length > 0 && tool_choice !== "none";
  const promptText = formatMessages(messages, hasPromptTools ? promptEngineeredTools : null, tool_choice);
  const hasTools = (Array.isArray(tools) && tools.length > 0 && tool_choice !== "none") || wantsNativeSearch;
  // Only force thinking model for prompt-engineered tools; native search works fine with any model
  const requestedModel = enforceThinkingForTools(model || process.env.DEFAULT_MODEL || "auto", hasPromptTools);

  // Apply per-key model policy.
  let targetModel = requestedModel;
  if (auth.source === "db" && auth.key) {
    if (auth.key.enforced_model) {
      targetModel = auth.key.enforced_model;
    } else if (
      Array.isArray(auth.key.allowed_models) &&
      auth.key.allowed_models.length > 0 &&
      !auth.key.allowed_models.includes(requestedModel)
    ) {
      req._meter.errorCode = "model_not_allowed";
      req._meter.errorMessage = `Model '${requestedModel}' not in allowed list for this key.`;
      req._meter.model = requestedModel;
      return res.status(403).json({
        error: {
          message: `Model '${requestedModel}' is not permitted for this API key.`,
          type: "invalid_request_error",
          code: "model_not_allowed",
        },
      });
    }
  }
  req._meter.model = targetModel;
  req._meter.isStream = stream === true;

  // Estimate input tokens up front; output is a rough guess until we see the real reply.
  const estIn = estimateMessageTokens(messages) + estimateTokens(promptText);
  const estOut = 512;
  req._meter.actualIn = estIn;

  // Reserve quota (atomic check + deduct in Postgres). Skips silently when DB
  // is not configured or when this isn't a metered key.
  if (auth.source === "db" && auth.key) {
    const reservation = await reserve(auth.key.id, targetModel, estIn, estOut);
    if (!reservation.ok && reservation.failingLimits) {
      req._meter.errorCode = "rate_limited";
      req._meter.errorMessage = "Rate limit exceeded.";
      req._meter.status = "rate_limited";
      return res.status(429).json({
        error: {
          message: "Rate limit exceeded for this API key.",
          type: "rate_limit_error",
          code: "rate_limited",
          failing_limits: reservation.failingLimits,
        },
      });
    }
    if (reservation.ok && reservation.reservationId) {
      req._meter.reservationId = reservation.reservationId;
    }
    // Fail-open on DB errors: log but continue. The dashboard will still see
    // the request_log row, just no reservation finalization.
    if (reservation.error) {
      console.error("[Meter] reserve failed:", reservation.error.message || reservation.error);
    }
  }

  const statefulEnabled = process.env.STATEFUL_MAPPING !== "false";
  let isStateful = false;
  let conversationId = null;
  let parentMessageId = null;
  let originalToolCalls = {};

  const N = messages.length - 1;
  const lastMsg = messages[N];
  const prefix = messages.slice(0, N);
  const prefixHash = getMessagesHash(prefix);

  if (statefulEnabled && !hasPromptTools) {
    const cached = conversationCache.get(prefixHash);
    if (cached) {
      isStateful = true;
      conversationId = cached.conversationId;
      parentMessageId = cached.parentMessageId;
      originalToolCalls = cached.originalToolCalls || {};
      console.log(`[Proxy] Stateful cache HIT for prefix hash ${prefixHash}. Convo: ${conversationId}, Parent: ${parentMessageId}`);
    } else if (messages.length === 1) {
      // First message, start stateful conversation
      isStateful = true;
      parentMessageId = uuidv4();
      console.log(`[Proxy] Stateful cache MISS but messages.length === 1. Starting new stateful conversation.`);
    } else {
      console.log(`[Proxy] Stateful cache MISS for multi-turn history. Falling back to prompt-engineered collapsed history.`);
    }
  }

  const completionId = `chatcmpl-${uuidv4().replace(/-/g, "").slice(0, 24)}`;
  let upstreamModelSlug = null; // best-effort: what ChatGPT backend says it used (if provided)

  let chatgptPayload;
  let chatgptMessageId = uuidv4();

  if (isStateful) {
    let authorRole = lastMsg.role;
    let authorName = lastMsg.name || undefined;
    let contentParts = [];
    let messageMetadata = {};

    if (authorRole === "tool") {
      // It's a tool execution result.
      // Map tool_call_id back to ChatGPT message ID if we can.
      const cachedTool = originalToolCalls[lastMsg.tool_call_id];
      if (cachedTool) {
        authorName = cachedTool.name;
        // If it was a custom tool call (Action), we send custom_tool_call_output
        messageMetadata.custom_tool_call_output = {
          call_id: cachedTool.call_id,
          output: typeof lastMsg.content === "string" ? lastMsg.content : JSON.stringify(lastMsg.content)
        };
      }
      contentParts = [typeof lastMsg.content === "string" ? lastMsg.content : JSON.stringify(lastMsg.content)];
    } else {
      // User message
      contentParts = [typeof lastMsg.content === "string" ? lastMsg.content : JSON.stringify(lastMsg.content)];
    }

    chatgptPayload = {
      action: "next",
      messages: [
        {
          id: chatgptMessageId,
          author: {
            role: authorRole,
            name: authorName
          },
          content: {
            content_type: "text",
            parts: contentParts
          },
          metadata: messageMetadata
        }
      ],
      parent_message_id: parentMessageId,
      conversation_id: conversationId || undefined,
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
  } else {
    // Collapsed prompt-engineered fallback
    chatgptPayload = {
      action: "next",
      messages: [
        {
          id: chatgptMessageId,
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
      parent_message_id: uuidv4(),
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
  }

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
      if (req._meter) {
        req._meter.errorCode = "upstream_error";
        req._meter.errorMessage = errText.slice(0, 1000);
      }
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

      // ── Client disconnect guard ────────────────────────────────────────
      let clientDisconnected = false;
      res.on("close", () => {
        clientDisconnected = true;
        console.log(`[Proxy] Client disconnected during stream (${completionId})`);
      });

      /** Write to the SSE stream, swallowing errors if the socket is already gone. */
      const safeWrite = (data) => {
        if (clientDisconnected) return false;
        try {
          res.write(data);
          return true;
        } catch (writeErr) {
          console.warn(`[Proxy] SSE write failed (${completionId}):`, writeErr.message);
          clientDisconnected = true;
          return false;
        }
      };

      let lastText = "";
      let buffer = "";
      let bufferedFull = ""; // used when hasPromptTools — we can't stream tokens through a tool parser
      let streamAnnotations = []; // URL citations from native search
      let activeStreamingToolCall = null;
      let latestMessageId = null;
      let latestConversationId = null;

      try {
      for await (const chunk of response.body) {
        if (clientDisconnected) break;
        buffer += new TextDecoder().decode(chunk);
        const lines = buffer.split("\n");
        buffer = lines.pop(); // Hold remaining incomplete line

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          if (trimmed === "data: [DONE]") {
            if (activeStreamingToolCall) {
              if (activeStreamingToolCall.deferred) {
                const allowedNames = allowedToolNameSet(promptEngineeredTools);
                const normalized = buildNormalizedToolCall(
                  activeStreamingToolCall.toolCallId,
                  activeStreamingToolCall.originalName || activeStreamingToolCall.name,
                  activeStreamingToolCall.lastArguments || "{}",
                  allowedNames
                );
                if (allowedNames.size === 0 || allowedNames.has(normalized.function.name)) {
                  emitChatToolCalls(safeWrite, completionId, upstreamModelSlug || targetModel, [normalized]);
                }
              } else {
                safeWrite(`data: ${JSON.stringify({
                  id: completionId,
                  object: "chat.completion.chunk",
                  created: Math.floor(Date.now() / 1000),
                  model: upstreamModelSlug || targetModel,
                  choices: [{
                    index: 0,
                    delta: {},
                    finish_reason: "tool_calls"
                  }]
                })}\n\n`);
              }

              if (isStateful && latestConversationId && latestMessageId) {
                const assistantResponse = {
                  role: "assistant",
                  content: null,
                  tool_calls: [{
                    id: activeStreamingToolCall.toolCallId,
                    type: "function",
                    function: {
                      name: activeStreamingToolCall.name,
                      arguments: activeStreamingToolCall.lastArguments
                    }
                  }]
                };
                const newOriginalToolCalls = {
                  ...originalToolCalls,
                  [activeStreamingToolCall.toolCallId]: {
                    call_id: activeStreamingToolCall.messageId,
                    name: activeStreamingToolCall.name
                  }
                };
                const nextHash = getMessagesHash(messages.concat([assistantResponse]));
                cacheConversationMapping(nextHash, latestConversationId, latestMessageId, newOriginalToolCalls);
                console.log(`[Proxy] Cached stateful tool call: Hash ${nextHash}, Convo: ${latestConversationId}, Msg: ${latestMessageId}`);
              }
              activeStreamingToolCall = null;
            } else if (hasPromptTools) {
              const allowedNames = new Set(promptEngineeredTools.map(t => t.function?.name).filter(Boolean));
              const { cleanedText, toolCalls } = extractToolCalls(bufferedFull, allowedNames);
              const finalModel = upstreamModelSlug || targetModel;
              if (toolCalls.length > 0) {
                emitChatToolCalls(safeWrite, completionId, finalModel, toolCalls);
              } else {
                if (cleanedText) {
                  safeWrite(`data: ${JSON.stringify({
                    id: completionId,
                    object: "chat.completion.chunk",
                    created: Math.floor(Date.now() / 1000),
                    model: finalModel,
                    choices: [{ index: 0, delta: { content: cleanedText }, finish_reason: null }]
                  })}\n\n`);
                }
                safeWrite(`data: ${JSON.stringify({
                  id: completionId,
                  object: "chat.completion.chunk",
                  created: Math.floor(Date.now() / 1000),
                  model: finalModel,
                  choices: [{ index: 0, delta: {}, finish_reason: "stop" }]
                })}\n\n`);
              }
            } else {
              // Emit annotations (from native search) in the final chunk if present
              const finalDelta = {};
              if (streamAnnotations.length > 0) {
                const seen = new Set();
                finalDelta.annotations = streamAnnotations.filter((a) => {
                  if (seen.has(a.url)) return false;
                  seen.add(a.url);
                  return true;
                });
              }
              safeWrite(`data: ${JSON.stringify({
                id: completionId,
                object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000),
                model: upstreamModelSlug || targetModel,
                choices: [{ index: 0, delta: finalDelta, finish_reason: "stop" }]
              })}\n\n`);

              if (isStateful && latestConversationId && latestMessageId) {
                const assistantResponse = {
                  role: "assistant",
                  content: lastText || null
                };
                const nextHash = getMessagesHash(messages.concat([assistantResponse]));
                cacheConversationMapping(nextHash, latestConversationId, latestMessageId, originalToolCalls);
                console.log(`[Proxy] Cached stateful response: Hash ${nextHash}, Convo: ${latestConversationId}, Msg: ${latestMessageId}`);
              }
            }
            safeWrite("data: [DONE]\n\n");
            req._meter.actualOut = estimateTokens(lastText);
            if (!clientDisconnected) res.end();
            return;
          }

          if (trimmed.startsWith("data: ")) {
            try {
              const jsonStr = trimmed.slice(6);
              if (jsonStr === "[DONE]") continue;

              const parsed = JSON.parse(jsonStr);
              latestConversationId = latestConversationId || parsed?.conversation_id;
              if (parsed?.message?.id) {
                latestMessageId = parsed.message.id;
              }

              // Best-effort extraction of upstream-selected model slug (fields vary over time)
              upstreamModelSlug =
                upstreamModelSlug ||
                parsed?.model ||
                parsed?.model_slug ||
                parsed?.message?.metadata?.model_slug ||
                parsed?.message?.metadata?.requested_model_slug ||
                null;

              const cat = categorizeMessage(parsed);

              if (cat?.type === "assistant") {
                // Check if it's a client-side tool call
                if (cat.recipient && cat.recipient !== "all" && !SERVER_TOOLS.has(cat.recipient)) {
                  const allowedNames = allowedToolNameSet(promptEngineeredTools);
                  const msgId = parsed.message.id;
                  if (!activeStreamingToolCall || activeStreamingToolCall.messageId !== msgId) {
                    const normalized = buildNormalizedToolCall("call_" + msgId, cat.recipient, cat.text || "{}", allowedNames);
                    if (allowedNames.size > 0 && !allowedNames.has(normalized.function.name)) {
                      console.warn(`[Proxy] Dropping recipient tool call '${normalized.function.name}' — not in client's tools list.`);
                      continue;
                    }
                    const deferUntilComplete = cat.recipient !== normalized.function.name;
                    activeStreamingToolCall = {
                      messageId: msgId,
                      toolCallId: "call_" + msgId,
                      name: normalized.function.name,
                      originalName: cat.recipient,
                      lastArguments: deferUntilComplete ? (cat.text || "") : "",
                      deferred: deferUntilComplete
                    };
                    if (!deferUntilComplete) {
                      safeWrite(`data: ${JSON.stringify({
                        id: completionId,
                        object: "chat.completion.chunk",
                        created: Math.floor(Date.now() / 1000),
                        model: upstreamModelSlug || targetModel,
                        choices: [{
                          index: 0,
                          delta: {
                            role: "assistant",
                            tool_calls: [{
                              index: 0,
                              id: activeStreamingToolCall.toolCallId,
                              type: "function",
                              function: {
                                name: activeStreamingToolCall.name,
                                arguments: ""
                              }
                            }]
                          },
                          finish_reason: null
                        }]
                      })}\n\n`);
                    }
                  }

                  const delta = cat.text.slice(activeStreamingToolCall.lastArguments.length);
                  if (delta) {
                    activeStreamingToolCall.lastArguments = cat.text;
                    if (!activeStreamingToolCall.deferred) {
                      safeWrite(`data: ${JSON.stringify({
                        id: completionId,
                        object: "chat.completion.chunk",
                        created: Math.floor(Date.now() / 1000),
                        model: upstreamModelSlug || targetModel,
                        choices: [{
                          index: 0,
                          delta: {
                            tool_calls: [{
                              index: 0,
                              function: {
                                arguments: delta
                              }
                            }]
                          },
                          finish_reason: null
                        }]
                      })}\n\n`);
                    }
                  }
                  continue; // Skip normal text delta rendering for tool calls
                }

                const currentText = cat.text || "";

                // Collect annotations from assistant metadata
                const msgAnnotations = extractAnnotations(cat.metadata);
                if (msgAnnotations.length > 0) {
                  streamAnnotations.push(...msgAnnotations);
                }

                if (currentText && currentText.startsWith(lastText)) {
                  const delta = currentText.slice(lastText.length);
                  lastText = currentText;

                  if (delta) {
                    if (hasPromptTools) {
                      bufferedFull = currentText;
                      if (shouldTryEarlyToolExtraction(bufferedFull)) {
                        const allowedNames = new Set(promptEngineeredTools.map(t => t.function?.name).filter(Boolean));
                        const { toolCalls } = extractToolCalls(bufferedFull, allowedNames);
                        if (toolCalls.length > 0) {
                          const finalModel = upstreamModelSlug || targetModel;
                          emitChatToolCalls(safeWrite, completionId, finalModel, toolCalls);
                          safeWrite("data: [DONE]\n\n");
                          req._meter.actualOut = estimateTokens(JSON.stringify(toolCalls));
                          if (!clientDisconnected) res.end();
                          return;
                        }
                      }
                      // do not forward token deltas while tools may be in flight
                      continue;
                    }
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
                    safeWrite(`data: ${JSON.stringify(chunkPayload)}\n\n`);
                  }
                }
              } else if (cat?.type === "tool") {
                // Native tool output (browser, python, etc.) — capture annotations
                const toolAnnotations = extractAnnotations(cat.metadata);
                if (toolAnnotations.length > 0) {
                  streamAnnotations.push(...toolAnnotations);
                }
                console.log(`[Proxy] Stream: native tool message: author=${cat.authorName}, text_len=${String(cat.text).length}`);
              }
            } catch (e) {
              // Ignore lines that are not valid JSON
            }
          }
        }
      }
      } catch (streamErr) {
        // Upstream read error (e.g. ECONNRESET from ChatGPT) — log and close gracefully.
        console.error(`[Proxy] SSE stream read error (${completionId}):`, streamErr.message);
      }

      // Finish cleanly if loop ends (or errored out)
      safeWrite("data: [DONE]\n\n");
      req._meter.actualOut = estimateTokens(lastText);
      if (!clientDisconnected) res.end();
      return;
    } else {
      // 6. Non-Streaming Response Handling
      let fullContent = "";
      let buffer = "";
      let nativeToolOutputs = []; // Collect native tool messages (browser, python, etc.)
      let collectedAnnotations = []; // URL citations from native search
      let latestMessageId = null;
      let latestConversationId = null;
      let collectedToolCalls = [];

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
              latestConversationId = latestConversationId || parsed?.conversation_id;
              if (parsed?.message?.id) {
                latestMessageId = parsed.message.id;
              }

              // Best-effort extraction of upstream-selected model slug (fields vary over time)
              upstreamModelSlug =
                upstreamModelSlug ||
                parsed?.model ||
                parsed?.model_slug ||
                parsed?.message?.metadata?.model_slug ||
                parsed?.message?.metadata?.requested_model_slug ||
                null;

              const cat = categorizeMessage(parsed);
              if (cat?.type === "assistant") {
                // Check if it's a client-side tool call
                if (cat.recipient && cat.recipient !== "all" && !SERVER_TOOLS.has(cat.recipient)) {
                  const toolCallId = "call_" + parsed.message.id;
                  const allowedNames = allowedToolNameSet(promptEngineeredTools);
                  const normalized = buildNormalizedToolCall(toolCallId, cat.recipient, cat.text || "{}", allowedNames);
                  if (allowedNames.size > 0 && !allowedNames.has(normalized.function.name)) {
                    console.warn(`[Proxy] Dropping recipient tool call '${normalized.function.name}' — not in client's tools list.`);
                    continue;
                  }
                  if (!collectedToolCalls.some(tc => tc.id === toolCallId)) {
                    collectedToolCalls.push(normalized);
                  } else {
                    const tc = collectedToolCalls.find(tc => tc.id === toolCallId);
                    if (tc) {
                      tc.function.name = normalized.function.name;
                      tc.function.arguments = normalized.function.arguments;
                    }
                  }
                } else {
                  fullContent = cat.text || fullContent;
                  // Collect annotations from assistant message metadata too
                  const msgAnnotations = extractAnnotations(cat.metadata);
                  if (msgAnnotations.length > 0) {
                    collectedAnnotations.push(...msgAnnotations);
                  }
                }
              } else if (cat?.type === "tool") {
                // Native tool output (browser search, code interpreter, etc.)
                nativeToolOutputs.push({
                  authorName: cat.authorName,
                  text: cat.text,
                  metadata: cat.metadata,
                });
                // Extract citations from tool metadata
                const toolAnnotations = extractAnnotations(cat.metadata);
                if (toolAnnotations.length > 0) {
                  collectedAnnotations.push(...toolAnnotations);
                }
                console.log(`[Proxy] Native tool message: author=${cat.authorName}, text_len=${String(cat.text).length}`);
              }
            } catch (e) {
              // Ignore
            }
          }
        }
      }

      const assistantMsg = { role: "assistant", content: null };
      let finishReason = "stop";

      if (collectedToolCalls.length > 0) {
        assistantMsg.tool_calls = collectedToolCalls;
        assistantMsg.content = null;
        finishReason = "tool_calls";

        // Cache the state for tool call!
        if (isStateful && latestConversationId && latestMessageId) {
          const newOriginalToolCalls = { ...originalToolCalls };
          for (const tc of collectedToolCalls) {
            newOriginalToolCalls[tc.id] = {
              call_id: tc.id.replace(/^call_/, ""),
              name: tc.function.name
            };
          }
          const nextHash = getMessagesHash(messages.concat([assistantMsg]));
          cacheConversationMapping(nextHash, latestConversationId, latestMessageId, newOriginalToolCalls);
          console.log(`[Proxy] (Non-stream) Cached stateful tool call: Hash ${nextHash}, Convo: ${latestConversationId}, Msg: ${latestMessageId}`);
        }
      } else {
        // Only run prompt-engineered tool extraction when we have prompt-engineered tools
        const allowedNames = new Set(promptEngineeredTools.map(t => t.function?.name).filter(Boolean));
        const { cleanedText, toolCalls } = hasPromptTools
          ? extractToolCalls(fullContent, allowedNames)
          : { cleanedText: fullContent, toolCalls: [] };

        if (toolCalls.length > 0) {
          assistantMsg.tool_calls = toolCalls;
          if (!cleanedText) assistantMsg.content = null;
          finishReason = "tool_calls";
        } else {
          assistantMsg.content = cleanedText || null;
          finishReason = "stop";

          // Cache the state for text reply!
          if (isStateful && latestConversationId && latestMessageId) {
            const nextHash = getMessagesHash(messages.concat([assistantMsg]));
            cacheConversationMapping(nextHash, latestConversationId, latestMessageId, originalToolCalls);
            console.log(`[Proxy] (Non-stream) Cached stateful response: Hash ${nextHash}, Convo: ${latestConversationId}, Msg: ${latestMessageId}`);
          }
        }
      }

      // Attach annotations (URL citations from native search) if any
      if (collectedAnnotations.length > 0) {
        // Deduplicate by URL
        const seen = new Set();
        assistantMsg.annotations = collectedAnnotations.filter((a) => {
          if (seen.has(a.url)) return false;
          seen.add(a.url);
          return true;
        });
      }

      const outTokens = estimateTokens(assistantMsg.content || "") + estimateTokens(JSON.stringify(assistantMsg.tool_calls || []));
      req._meter.actualOut = outTokens;

      return res.json({
        id: completionId,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: upstreamModelSlug || targetModel,
        choices: [
          {
            index: 0,
            message: assistantMsg,
            finish_reason: finishReason
          }
        ],
        usage: {
          prompt_tokens: req._meter.actualIn || 0,
          completion_tokens: outTokens,
          total_tokens: (req._meter.actualIn || 0) + outTokens
        }
      });
    }

  } catch (err) {
    console.error("[Proxy] Unexpected server error during fetch:", err.message);
    if (req._meter) {
      req._meter.errorCode = "internal_server_error";
      req._meter.errorMessage = err.message;
    }
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
}

app.post("/v1/chat/completions", chatCompletionsHandler);
app.post("/chat/completions", chatCompletionsHandler);

// =============================================================================
// /v1/responses — OpenAI Responses API bridge
//
// Codex CLI (and other newer agentic clients) only speak the Responses wire
// protocol. This endpoint translates Responses → Chat Completions on the way
// in, calls our internal handler, and translates the reply back into the
// item-based Responses shape (plus its named-event SSE lifecycle).
//
// Stateless: previous_response_id / conversation are NOT honored. Caller must
// send full history in `input`.
// =============================================================================

/**
 * Convert a Responses-shape request body into a Chat Completions body.
 * Returns { chatBody, callIdToToolCallId } — the second is a map we use to
 * rewrite ids on the way back so Codex sees the call_ids it sent us.
 */
function responsesToChat(body) {
  const messages = [];
  const callIdToToolCallId = new Map();
  let nextSyntheticId = 0;

  if (body.instructions && typeof body.instructions === "string") {
    messages.push({ role: "system", content: body.instructions });
  }

  const items = Array.isArray(body.input)
    ? body.input
    : typeof body.input === "string"
      ? [{ type: "message", role: "user", content: body.input }]
      : [];

  // Buffer tool_calls per assistant message so we collapse a contiguous run of
  // function_call items into one assistant message with multiple tool_calls.
  let pendingAssistant = null;
  const flushAssistant = () => {
    if (pendingAssistant) {
      messages.push(pendingAssistant);
      pendingAssistant = null;
    }
  };

  for (const item of items) {
    if (!item || !item.type) continue;

    if (item.type === "message") {
      flushAssistant();
      const role = item.role || "user";
      let content = "";
      if (typeof item.content === "string") {
        content = item.content;
      } else if (Array.isArray(item.content)) {
        content = item.content
          .map((c) => c?.text ?? c?.input_text ?? c?.output_text ?? "")
          .join("");
      }
      messages.push({ role, content });
    } else if (item.type === "function_call") {
      const toolCallId =
        callIdToToolCallId.get(item.call_id) ||
        `call_${Date.now().toString(36)}_${nextSyntheticId++}`;
      callIdToToolCallId.set(item.call_id, toolCallId);
      if (!pendingAssistant) {
        pendingAssistant = { role: "assistant", content: null, tool_calls: [] };
      }
      pendingAssistant.tool_calls.push({
        id: toolCallId,
        type: "function",
        function: {
          name: item.name || "unknown",
          arguments:
            typeof item.arguments === "string"
              ? item.arguments
              : JSON.stringify(item.arguments ?? {}),
        },
      });
    } else if (item.type === "function_call_output") {
      flushAssistant();
      const toolCallId =
        callIdToToolCallId.get(item.call_id) || item.call_id || "unknown";
      const out =
        typeof item.output === "string"
          ? item.output
          : JSON.stringify(item.output ?? "");
      messages.push({ role: "tool", tool_call_id: toolCallId, content: out });
    } else if (item.type === "reasoning") {
      // Drop reasoning items — ChatGPT Web doesn't accept them and the proxy
      // can't replay them meaningfully.
      continue;
    }
  }
  flushAssistant();

  // Convert Responses-style internally-tagged tools to Chat externally-tagged.
  // Preserve native tool types (web_search_preview, web_search) alongside function tools.
  let chatTools;
  if (Array.isArray(body.tools) && body.tools.length > 0) {
    chatTools = [];
    for (const t of body.tools) {
      if (!t) continue;
      if (t.type === "function") {
        chatTools.push({
          type: "function",
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        });
      } else if (t.type === "web_search_preview" || t.type === "web_search") {
        // Pass through native search tool as-is — the inner handler will detect it
        chatTools.push(t);
      }
    }
  }

  let toolChoice = body.tool_choice;
  if (toolChoice && typeof toolChoice === "object" && toolChoice.type === "function") {
    toolChoice = { type: "function", function: { name: toolChoice.name } };
  }

  const chatBody = {
    model: body.model,
    messages,
    stream: body.stream === true,
  };
  if (chatTools) chatBody.tools = chatTools;
  if (toolChoice !== undefined) chatBody.tool_choice = toolChoice;

  return { chatBody, callIdToToolCallId };
}

/**
 * Build a Responses-shape JSON body from a buffered Chat completion response.
 */
function chatToResponses(chatJson, responseId, callIdToToolCallId) {
  const choice = chatJson.choices?.[0] || {};
  const msg = choice.message || {};
  const output = [];

  const invertId = (toolCallId) => {
    for (const [callId, id] of callIdToToolCallId.entries()) {
      if (id === toolCallId) return callId;
    }
    return toolCallId;
  };

  if (msg.content && typeof msg.content === "string" && msg.content.length > 0) {
    // Include annotations (URL citations from native search) if present
    const annotations = Array.isArray(msg.annotations) ? msg.annotations : [];
    output.push({
      id: `msg_${responseId}`,
      type: "message",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: msg.content, annotations }],
    });
  }

  if (Array.isArray(msg.tool_calls)) {
    for (const tc of msg.tool_calls) {
      output.push({
        id: `fc_${tc.id}`,
        type: "function_call",
        status: "completed",
        call_id: invertId(tc.id),
        name: tc.function?.name || "unknown",
        arguments: tc.function?.arguments || "{}",
      });
    }
  }

  const status =
    choice.finish_reason === "tool_calls" ? "completed" : "completed";

  return {
    id: responseId,
    object: "response",
    created_at: chatJson.created || Math.floor(Date.now() / 1000),
    status,
    model: chatJson.model,
    output,
    usage: {
      input_tokens: chatJson.usage?.prompt_tokens || 0,
      output_tokens: chatJson.usage?.completion_tokens || 0,
      total_tokens: chatJson.usage?.total_tokens || 0,
    },
  };
}

app.post("/v1/responses", async (req, res) => {
  installMeterHook(req, res);

  // Authenticate + apply per-key model policy at this layer; the inner call to
  // /v1/chat/completions is bypassed via X-Internal-Bypass so it doesn't double-meter.
  const auth = await authenticateRequest(req);
  if (!auth.authorized) {
    req._meter.errorCode = "unauthorized";
    return res.status(401).json({
      error: {
        message: "Invalid or missing API key.",
        type: "invalid_request_error",
        code: "unauthorized",
      },
    });
  }
  if (auth.source === "db" && auth.key) {
    req._meter.keyId = auth.key.id;
  }

  const responseId = `resp_${uuidv4().replace(/-/g, "")}`;
  const wantsStream = req.body?.stream === true;
  req._meter.isStream = wantsStream;

  let translated;
  try {
    translated = responsesToChat(req.body || {});
  } catch (err) {
    req._meter.errorCode = "bad_request";
    req._meter.errorMessage = err.message;
    return res.status(400).json({
      error: {
        message: `Failed to translate Responses request: ${err.message}`,
        type: "invalid_request_error",
        code: "bad_request",
      },
    });
  }

  if (req.body?.previous_response_id || req.body?.conversation) {
    req._meter.errorCode = "stateful_not_supported";
    return res.status(400).json({
      error: {
        message:
          "Stateless bridge: previous_response_id and conversation are not supported. Send full history in `input`.",
        type: "invalid_request_error",
        code: "stateful_not_supported",
      },
    });
  }

  const { chatBody, callIdToToolCallId } = translated;

  // Apply per-key model policy on the translated chat body.
  const responseHasTools = Array.isArray(chatBody.tools) && chatBody.tools.length > 0 && chatBody.tool_choice !== "none";
  const requestedModel = enforceThinkingForTools(chatBody.model || process.env.DEFAULT_MODEL || "auto", responseHasTools);
  let effectiveModel = requestedModel;
  if (auth.source === "db" && auth.key) {
    if (auth.key.enforced_model) {
      effectiveModel = auth.key.enforced_model;
    } else if (
      Array.isArray(auth.key.allowed_models) &&
      auth.key.allowed_models.length > 0 &&
      !auth.key.allowed_models.includes(requestedModel)
    ) {
      req._meter.errorCode = "model_not_allowed";
      req._meter.errorMessage = `Model '${requestedModel}' not in allowed list for this key.`;
      req._meter.model = requestedModel;
      return res.status(403).json({
        error: {
          message: `Model '${requestedModel}' is not permitted for this API key.`,
          type: "invalid_request_error",
          code: "model_not_allowed",
        },
      });
    }
  }
  chatBody.model = effectiveModel;
  req._meter.model = effectiveModel;

  const estIn = estimateMessageTokens(chatBody.messages || []);
  const estOut = 512;
  req._meter.actualIn = estIn;

  if (auth.source === "db" && auth.key) {
    const reservation = await reserve(auth.key.id, effectiveModel, estIn, estOut);
    if (!reservation.ok && reservation.failingLimits) {
      req._meter.errorCode = "rate_limited";
      req._meter.errorMessage = "Rate limit exceeded.";
      req._meter.status = "rate_limited";
      return res.status(429).json({
        error: {
          message: "Rate limit exceeded for this API key.",
          type: "rate_limit_error",
          code: "rate_limited",
          failing_limits: reservation.failingLimits,
        },
      });
    }
    if (reservation.ok && reservation.reservationId) {
      req._meter.reservationId = reservation.reservationId;
    }
    if (reservation.error) {
      console.error("[Meter] reserve failed:", reservation.error.message || reservation.error);
    }
  }

  // Always non-streaming internally — we buffer the Chat response and either
  // return JSON or synthesize Responses-shape SSE events.
  const internalBody = { ...chatBody, stream: false };

  let chatJson;
  try {
    const internalRes = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: req.headers.authorization || "",
        "X-Internal-Bypass": INTERNAL_BYPASS_TOKEN,
      },
      body: JSON.stringify(internalBody),
    });
    if (!internalRes.ok) {
      const errText = await internalRes.text();
      req._meter.errorCode = "upstream_error";
      req._meter.errorMessage = errText.slice(0, 1000);
      return res.status(internalRes.status).send(errText);
    }
    chatJson = await internalRes.json();
  } catch (err) {
    req._meter.errorCode = "internal_server_error";
    req._meter.errorMessage = err.message;
    return res.status(500).json({
      error: {
        message: `Internal bridge call failed: ${err.message}`,
        type: "api_error",
        code: "internal_server_error",
      },
    });
  }

  const responseBody = chatToResponses(chatJson, responseId, callIdToToolCallId);
  req._meter.actualOut = chatJson?.usage?.completion_tokens || 0;

  if (!wantsStream) {
    return res.json(responseBody);
  }

  // Stream: synthesize the Responses SSE lifecycle from the buffered result.
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  let seq = 0;
  const sendEvent = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify({ sequence_number: seq++, type: event, ...data })}\n\n`);
  };

  const initial = { ...responseBody, status: "in_progress", output: [] };
  sendEvent("response.created", { response: initial });
  sendEvent("response.in_progress", { response: initial });

  for (let i = 0; i < responseBody.output.length; i++) {
    const item = responseBody.output[i];

    if (item.type === "message") {
      const stub = { ...item, status: "in_progress", content: [] };
      sendEvent("response.output_item.added", { output_index: i, item: stub });
      sendEvent("response.content_part.added", {
        item_id: item.id,
        output_index: i,
        content_index: 0,
        part: { type: "output_text", text: "", annotations: [] },
      });
      const text = item.content[0]?.text || "";
      if (text) {
        sendEvent("response.output_text.delta", {
          item_id: item.id,
          output_index: i,
          content_index: 0,
          delta: text,
        });
        sendEvent("response.output_text.done", {
          item_id: item.id,
          output_index: i,
          content_index: 0,
          text,
        });
      }
      sendEvent("response.content_part.done", {
        item_id: item.id,
        output_index: i,
        content_index: 0,
        part: { type: "output_text", text, annotations: [] },
      });
      sendEvent("response.output_item.done", { output_index: i, item });
    } else if (item.type === "function_call") {
      const stub = { ...item, arguments: "", status: "in_progress" };
      sendEvent("response.output_item.added", { output_index: i, item: stub });
      if (item.arguments) {
        sendEvent("response.function_call_arguments.delta", {
          item_id: item.id,
          output_index: i,
          delta: item.arguments,
        });
        sendEvent("response.function_call_arguments.done", {
          item_id: item.id,
          output_index: i,
          arguments: item.arguments,
        });
      }
      sendEvent("response.output_item.done", { output_index: i, item });
    }
  }

  sendEvent("response.completed", { response: responseBody });
  res.write("data: [DONE]\n\n");
  res.end();
});

// Start Server — listens only when this file is the entry point (skipped when
// required as a module, e.g. from a serverless wrapper).
if (require.main === module) {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`====================================================`);
    console.log(` ChatGPT Unofficial API Proxy Server is running!`);
    console.log(` Listening on: http://localhost:${PORT}`);
    console.log(` Base API endpoint: http://localhost:${PORT}/v1`);
    console.log(`====================================================`);
  });
}

app._internals = {
  extractToolCalls,
  buildToolSystemPrompt,
  normalizeUnavailableToolCall,
  buildNormalizedToolCall,
  shouldTryEarlyToolExtraction,
};

module.exports = app;

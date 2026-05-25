const BASE_URL = process.env.BASE_URL || "http://localhost:3002/v1";

// If output is piped (e.g. `| head`) and the pipe closes early, avoid crashing with EPIPE.
process.stdout.on("error", (err) => {
  if (err && err.code === "EPIPE") process.exit(0);
});

async function getModels() {
  const headers = {};
  const apiKey = process.env.PROXY_API_KEY || process.env.API_KEY;
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }
  const r = await fetch(`${BASE_URL}/models`, { headers });
  if (!r.ok) throw new Error(`GET /models failed: ${r.status}`);
  const j = await r.json();
  const ids = (j?.data || []).map((m) => m.id).filter(Boolean);
  return ids;
}

async function chatOnce(modelId) {
  const payload = {
    model: modelId,
    stream: false,
    messages: [
      {
        role: "system",
        content:
          'Return ONLY strict JSON: {"self_report_model": string|null}. If you cannot know your exact model identifier, use null.',
      },
      { role: "user", content: "What is your exact model identifier?" },
    ],
  };

  const headers = { "Content-Type": "application/json" };
  const apiKey = process.env.PROXY_API_KEY || process.env.API_KEY;
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const r = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  const text = await r.text();
  if (!r.ok) {
    return {
      requested_model: modelId,
      http_status: r.status,
      error: text.slice(0, 500),
    };
  }

  let j;
  try {
    j = JSON.parse(text);
  } catch {
    return {
      requested_model: modelId,
      http_status: r.status,
      error: `Non-JSON response from proxy: ${text.slice(0, 200)}`,
    };
  }

  const content = j?.choices?.[0]?.message?.content ?? "";
  let self = null;
  try {
    const parsed = JSON.parse(content);
    self = parsed?.self_report_model ?? null;
  } catch {
    // Model didn't follow strict JSON; keep raw.
    self = null;
  }

  return {
    requested_model: modelId,
    response_model_field: j?.model ?? null,
    proxy_model_matches_request: (j?.model ?? null) === modelId,
    self_report_model: self,
    raw_content_sample: String(content).slice(0, 120),
  };
}

function pad(s, n) {
  s = String(s ?? "");
  return s.length >= n ? s.slice(0, n - 1) + "…" : s.padEnd(n, " ");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const ids = await getModels();
  if (!ids.length) {
    console.error("No models returned from /v1/models");
    process.exit(2);
  }

  console.log(`BASE_URL=${BASE_URL}`);
  console.log(`Models: ${ids.join(", ")}`);
  console.log("");
  console.log(
    [
      pad("requested", 18),
      pad("response.model", 18),
      pad("match?", 7),
      pad("self_report", 18),
      "content(sample)",
    ].join("  ")
  );

  for (const id of ids) {
    const row = await chatOnce(id);
    console.log(
      [
        pad(row.requested_model, 18),
        pad(row.response_model_field ?? `HTTP ${row.http_status}`, 18),
        pad(row.proxy_model_matches_request ? "yes" : "no", 7),
        pad(row.self_report_model ?? "null", 18),
        row.raw_content_sample ?? "",
      ].join("  ")
    );
    // Tiny pacing to reduce rate-limit risk.
    await sleep(250);
  }

  console.log(
    "\nNote: this gateway may return either (a) the requested model id or (b) a best-effort upstream model slug extracted from ChatGPT's SSE payload when present. This is not a hard guarantee of upstream model selection."
  );
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});

/**
 * Token estimation. ChatGPT Web returns 0 for everything, so we estimate
 * locally. We use ~4 chars per token (the standard rough OpenAI guideline)
 * which is fine for rate-limit accounting at this granularity — the user
 * can see "estimated" tooltips in the dashboard.
 */

function estimateTokens(text) {
  if (!text) return 0;
  const str = typeof text === "string" ? text : String(text);
  return Math.ceil(str.length / 4);
}

function estimateMessageTokens(messages) {
  if (!Array.isArray(messages)) return 0;
  let total = 0;
  for (const m of messages) {
    total += 4;
    if (m == null) continue;
    if (typeof m.content === "string") {
      total += estimateTokens(m.content);
    } else if (Array.isArray(m.content)) {
      for (const part of m.content) {
        if (typeof part === "string") total += estimateTokens(part);
        else if (part && typeof part.text === "string") total += estimateTokens(part.text);
      }
    }
    if (m.name) total += estimateTokens(m.name);
    if (m.tool_calls) total += estimateTokens(JSON.stringify(m.tool_calls));
  }
  return total + 2;
}

module.exports = { estimateTokens, estimateMessageTokens };

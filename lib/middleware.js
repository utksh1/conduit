const crypto = require("crypto");
const { isEnabled } = require("./supabase");
const { validateApiKey } = require("./keys");
const { reserve, finalize, logRequest } = require("./rateLimits");
const { estimateTokens, estimateMessageTokens } = require("./tokens");

// A random per-process token. /v1/responses uses it when it loops back to
// /v1/chat/completions over loopback so the inner call skips auth+metering
// (the outer /v1/responses handler already metered the user-facing request).
const INTERNAL_BYPASS_TOKEN = crypto.randomBytes(32).toString("hex");

function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) return fwd.split(",")[0].trim();
  return req.socket?.remoteAddress || null;
}

function deriveStatus(statusCode, fallback) {
  if (fallback) return fallback;
  if (statusCode === 429) return "rate_limited";
  if (statusCode === 401 || statusCode === 403) return "auth_failed";
  if (statusCode >= 200 && statusCode < 300) return "success";
  return "error";
}

async function authenticateRequest(req) {
  const authHeader = req.headers["authorization"] || "";
  const clientToken = authHeader.replace(/^Bearer\s+/i, "").trim();

  // Allow requests originating from panel.utksh.in to bypass API key verification
  const origin = req.headers["origin"] || "";
  const referer = req.headers["referer"] || "";
  if (
    origin === "https://panel.utksh.in" ||
    origin === "http://panel.utksh.in" ||
    referer.startsWith("https://panel.utksh.in/") ||
    referer.startsWith("http://panel.utksh.in/")
  ) {
    return { authorized: true, source: "panel", clientToken };
  }

  if (req.headers["x-internal-bypass"] === INTERNAL_BYPASS_TOKEN) {
    return { authorized: true, source: "internal", clientToken };
  }

  if (clientToken && clientToken.startsWith("ey")) {
    return { authorized: true, source: "raw", clientToken };
  }

  if (process.env.PROXY_API_KEY && clientToken === process.env.PROXY_API_KEY) {
    return { authorized: true, source: "legacy", clientToken };
  }

  if (isEnabled() && clientToken) {
    const validated = await validateApiKey(clientToken);
    if (validated && validated.source === "db") {
      return { authorized: true, source: "db", clientToken, key: validated.key };
    }
  }

  if (!process.env.PROXY_API_KEY && !isEnabled()) {
    return { authorized: true, source: "open", clientToken };
  }

  return { authorized: false };
}

/**
 * Install a finish/close hook on `res` that finalizes any active reservation
 * and writes a row to request_logs once the response is fully sent. Idempotent.
 */
function installMeterHook(req, res) {
  if (req._meterInstalled) return;
  req._meterInstalled = true;

  const meter = (req._meter = {
    keyId: null,
    reservationId: null,
    endpoint: req.path,
    model: null,
    isStream: false,
    startTime: Date.now(),
    actualIn: 0,
    actualOut: 0,
    errorCode: null,
    errorMessage: null,
    status: null,
    clientIp: clientIp(req),
  });

  let fired = false;
  const onEnd = async () => {
    if (fired) return;
    fired = true;
    try {
      const latency = Date.now() - meter.startTime;
      if (meter.reservationId) {
        await finalize(meter.reservationId, meter.actualIn, meter.actualOut);
      }
      if (meter.keyId) {
        await logRequest({
          api_key_id: meter.keyId,
          endpoint: meter.endpoint,
          model: meter.model || null,
          status_code: res.statusCode,
          status: deriveStatus(res.statusCode, meter.status),
          error_code: meter.errorCode,
          error_message: meter.errorMessage,
          input_tokens: meter.actualIn,
          output_tokens: meter.actualOut,
          total_tokens: meter.actualIn + meter.actualOut,
          latency_ms: latency,
          streaming: meter.isStream,
          client_ip: meter.clientIp,
        });
      }
    } catch (err) {
      console.error("[Meter] hook error:", err.message);
    }
  };
  res.on("finish", onEnd);
  res.on("close", onEnd);
}

module.exports = {
  INTERNAL_BYPASS_TOKEN,
  authenticateRequest,
  installMeterHook,
  reserve,
  estimateTokens,
  estimateMessageTokens,
  clientIp,
};

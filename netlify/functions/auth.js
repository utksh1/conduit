const {
  getSupabase,
  hashPassword,
  verifyPassword,
  jwtSign,
  jwtVerify,
  json,
  clientIp,
  parseBody,
  audit,
} = require("./_lib/shared");

const failuresByIp = new Map();
const MAX_FAILURES = 5;
const FAILURE_WINDOW_MS = 5 * 60 * 1000;

function bumpFailure(ip) {
  if (!ip) return;
  const now = Date.now();
  const arr = (failuresByIp.get(ip) || []).filter((t) => now - t < FAILURE_WINDOW_MS);
  arr.push(now);
  failuresByIp.set(ip, arr);
}
function tooManyFailures(ip) {
  if (!ip) return false;
  const now = Date.now();
  const arr = (failuresByIp.get(ip) || []).filter((t) => now - t < FAILURE_WINDOW_MS);
  failuresByIp.set(ip, arr);
  return arr.length >= MAX_FAILURES;
}

exports.handler = async (event) => {
  const path = (event.path || "").replace(/^.*\/auth/, "") || "/";
  const supabase = getSupabase();
  const ip = clientIp(event);

  // GET /status — first-run check + JWT freshness check
  if (event.httpMethod === "GET" && path === "/status") {
    const { data, error } = await supabase
      .from("dashboard_settings")
      .select("password_hash,session_ttl_minutes")
      .eq("id", 1)
      .maybeSingle();
    if (error) return json(500, { error: error.message });
    const needsSetup = !data || !data.password_hash;
    const authHeader = event.headers.authorization || event.headers.Authorization || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const claims = token ? jwtVerify(token) : null;
    return json(200, { needsSetup, authenticated: Boolean(claims) });
  }

  // POST /setup — first password set
  if (event.httpMethod === "POST" && path === "/setup") {
    const { password } = parseBody(event);
    if (!password || typeof password !== "string" || password.length < 8) {
      return json(400, { error: "Password must be at least 8 characters." });
    }
    const { data: existing } = await supabase
      .from("dashboard_settings")
      .select("password_hash")
      .eq("id", 1)
      .maybeSingle();
    if (existing && existing.password_hash) {
      return json(409, { error: "Already set up. Use /login." });
    }
    const hash = hashPassword(password);
    const { error } = await supabase
      .from("dashboard_settings")
      .upsert({ id: 1, password_hash: hash, updated_at: new Date().toISOString() });
    if (error) return json(500, { error: error.message });
    const ttl = 12 * 60 * 60;
    await audit("dashboard.setup", null, ip);
    return json(200, { token: jwtSign({ sub: "admin" }, ttl) });
  }

  // POST /login
  if (event.httpMethod === "POST" && path === "/login") {
    if (tooManyFailures(ip)) {
      return json(429, { error: "Too many failed attempts. Try again later." });
    }
    const { password } = parseBody(event);
    if (!password) return json(400, { error: "Password required." });
    const { data, error } = await supabase
      .from("dashboard_settings")
      .select("password_hash,session_ttl_minutes")
      .eq("id", 1)
      .maybeSingle();
    if (error) return json(500, { error: error.message });
    if (!data || !data.password_hash) return json(409, { error: "Not set up yet." });
    if (!verifyPassword(password, data.password_hash)) {
      bumpFailure(ip);
      await audit("dashboard.login.failed", null, ip);
      return json(401, { error: "Invalid password." });
    }
    const ttl = (data.session_ttl_minutes || 720) * 60;
    await audit("dashboard.login", null, ip);
    return json(200, { token: jwtSign({ sub: "admin" }, ttl) });
  }

  return json(404, { error: "Not found" });
};

const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 32;
const SALT_BYTES = 16;
const KEY_PREFIX = "sk-cgpt-";
const KEY_BYTES = 24;

let supabaseClient = null;
function getSupabase() {
  if (supabaseClient) return supabaseClient;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env vars missing");
  supabaseClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: "chatgpt" },
  });
  return supabaseClient;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(SALT_BYTES);
  const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("base64")}$${derived.toString("base64")}`;
}

function verifyPassword(password, encoded) {
  if (!encoded || typeof encoded !== "string") return false;
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4], "base64");
  const expected = Buffer.from(parts[5], "base64");
  let derived;
  try {
    derived = crypto.scryptSync(password, salt, expected.length, { N, r, p });
  } catch {
    return false;
  }
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

function generateApiKey() {
  return KEY_PREFIX + crypto.randomBytes(KEY_BYTES).toString("base64url");
}
function keyPrefix(raw) {
  return raw.slice(0, KEY_PREFIX.length + 4);
}
function hashApiKey(raw) {
  return hashPassword(raw);
}

function base64UrlEncode(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}
function base64UrlDecode(str) {
  const pad = str.length % 4 === 0 ? 0 : 4 - (str.length % 4);
  return Buffer.from(str.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad), "base64");
}

function jwtSign(payload, ttlSeconds) {
  const secret = process.env.DASHBOARD_JWT_SECRET;
  if (!secret) throw new Error("DASHBOARD_JWT_SECRET missing");
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { ...payload, iat: now, exp: now + ttlSeconds };
  const headerStr = base64UrlEncode(JSON.stringify(header));
  const payloadStr = base64UrlEncode(JSON.stringify(fullPayload));
  const data = `${headerStr}.${payloadStr}`;
  const sig = base64UrlEncode(crypto.createHmac("sha256", secret).update(data).digest());
  return `${data}.${sig}`;
}

function jwtVerify(token) {
  const secret = process.env.DASHBOARD_JWT_SECRET;
  if (!secret) throw new Error("DASHBOARD_JWT_SECRET missing");
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const data = `${parts[0]}.${parts[1]}`;
  const expectedSig = base64UrlEncode(crypto.createHmac("sha256", secret).update(data).digest());
  const a = Buffer.from(parts[2]);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try {
    payload = JSON.parse(base64UrlDecode(parts[1]).toString("utf8"));
  } catch {
    return null;
  }
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

function clientIp(event) {
  const fwd = event.headers["x-forwarded-for"] || event.headers["X-Forwarded-For"];
  if (typeof fwd === "string" && fwd.length > 0) return fwd.split(",")[0].trim();
  return event.headers["x-nf-client-connection-ip"] || null;
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

async function requireAuth(event) {
  const header = event.headers.authorization || event.headers.Authorization || "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  const payload = jwtVerify(token);
  if (!payload) return null;
  return payload;
}

async function audit(action, details, ip) {
  try {
    const supabase = getSupabase();
    await supabase.from("audit_logs").insert({ action, details: details || null, actor_ip: ip || null });
  } catch (err) {
    console.error("[audit]", err.message);
  }
}

function parseBody(event) {
  if (!event.body) return {};
  if (event.isBase64Encoded) {
    return JSON.parse(Buffer.from(event.body, "base64").toString("utf8"));
  }
  try {
    return JSON.parse(event.body);
  } catch {
    return {};
  }
}

module.exports = {
  getSupabase,
  hashPassword,
  verifyPassword,
  generateApiKey,
  keyPrefix,
  hashApiKey,
  jwtSign,
  jwtVerify,
  requireAuth,
  audit,
  json,
  clientIp,
  parseBody,
};

const { getSupabase, isEnabled } = require("./supabase");
const { keyPrefix, verifyKey } = require("./hash");

const CACHE_TTL_MS = 60 * 1000;
const CACHE_MAX = 256;
const cache = new Map();

function cacheGet(rawKey) {
  const entry = cache.get(rawKey);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(rawKey);
    return null;
  }
  return entry.value;
}

function cacheSet(rawKey, value) {
  if (cache.size >= CACHE_MAX) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(rawKey, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

function invalidateCache(rawKey) {
  if (rawKey) cache.delete(rawKey);
  else cache.clear();
}

/**
 * Result shape:
 *   { source: "legacy" }
 *     - matched PROXY_API_KEY env var; no DB metering applies.
 *   { source: "db", key: { id, name, allowed_models, enforced_model, expires_at } }
 *     - matched a row in chatgpt.api_keys.
 *   null
 *     - no match (caller should 401).
 *
 * If Supabase is not configured, only the legacy path can match.
 */
async function validateApiKey(rawKey) {
  if (!rawKey || typeof rawKey !== "string") return null;

  if (process.env.PROXY_API_KEY && rawKey === process.env.PROXY_API_KEY) {
    return { source: "legacy" };
  }

  if (!isEnabled()) return null;

  const cached = cacheGet(rawKey);
  if (cached) return cached;

  const supabase = getSupabase();
  if (!supabase) return null;

  const prefix = keyPrefix(rawKey);
  const { data, error } = await supabase
    .from("api_keys")
    .select("id,name,key_hash,allowed_models,enforced_model,is_active,expires_at")
    .eq("key_prefix", prefix)
    .eq("is_active", true);

  if (error || !Array.isArray(data) || data.length === 0) return null;

  const now = Date.now();
  for (const row of data) {
    if (row.expires_at && new Date(row.expires_at).getTime() < now) continue;
    if (verifyKey(rawKey, row.key_hash)) {
      const value = {
        source: "db",
        key: {
          id: row.id,
          name: row.name,
          allowed_models: row.allowed_models || null,
          enforced_model: row.enforced_model || null,
          expires_at: row.expires_at,
        },
      };
      cacheSet(rawKey, value);
      return value;
    }
  }
  return null;
}

module.exports = { validateApiKey, invalidateCache };

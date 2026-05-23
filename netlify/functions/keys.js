const {
  getSupabase,
  generateApiKey,
  keyPrefix,
  hashApiKey,
  requireAuth,
  json,
  clientIp,
  parseBody,
  audit,
} = require("./_lib/shared");

function sanitizeLimits(limits) {
  if (!Array.isArray(limits)) return [];
  return limits
    .filter((l) => l && typeof l === "object")
    .map((l) => ({
      limit_type: l.limit_type,
      limit_window: l.limit_window, // ISO 8601 interval or PostgreSQL interval string e.g. "1 hour"
      max_value: Number(l.max_value),
      model_filter: l.model_filter || null,
    }))
    .filter(
      (l) =>
        ["requests", "input_tokens", "output_tokens", "total_tokens"].includes(l.limit_type) &&
        Number.isFinite(l.max_value) &&
        l.max_value > 0 &&
        typeof l.limit_window === "string" &&
        l.limit_window.length > 0,
    );
}

exports.handler = async (event) => {
  const claims = await requireAuth(event);
  if (!claims) return json(401, { error: "Unauthorized" });
  const supabase = getSupabase();
  const ip = clientIp(event);
  const path = (event.path || "").replace(/^.*\/keys/, "") || "/";

  // GET /keys — list
  if (event.httpMethod === "GET" && path === "/") {
    const { data, error } = await supabase
      .from("api_keys")
      .select("id,name,key_prefix,allowed_models,enforced_model,is_active,expires_at,created_at,last_used_at")
      .order("created_at", { ascending: false });
    if (error) return json(500, { error: error.message });

    if (Array.isArray(data) && data.length > 0) {
      const ids = data.map((k) => k.id);
      const { data: lims } = await supabase.from("api_key_limits").select("*").in("api_key_id", ids);
      const byKey = new Map();
      for (const l of lims || []) {
        const arr = byKey.get(l.api_key_id) || [];
        arr.push(l);
        byKey.set(l.api_key_id, arr);
      }
      for (const k of data) k.limits = byKey.get(k.id) || [];
    }
    return json(200, { keys: data || [] });
  }

  // POST /keys — create
  if (event.httpMethod === "POST" && path === "/") {
    const body = parseBody(event);
    if (!body.name || typeof body.name !== "string") {
      return json(400, { error: "Name required" });
    }
    const rawKey = generateApiKey();
    const insert = {
      name: body.name.trim().slice(0, 200),
      key_prefix: keyPrefix(rawKey),
      key_hash: hashApiKey(rawKey),
      allowed_models: Array.isArray(body.allowed_models) ? body.allowed_models : null,
      enforced_model: body.enforced_model || null,
      is_active: body.is_active !== false,
      expires_at: body.expires_at || null,
    };
    const { data: created, error } = await supabase.from("api_keys").insert(insert).select("*").single();
    if (error) return json(500, { error: error.message });

    const limits = sanitizeLimits(body.limits);
    if (limits.length > 0) {
      const rows = limits.map((l) => ({ ...l, api_key_id: created.id }));
      const { error: limErr } = await supabase.from("api_key_limits").insert(rows);
      if (limErr) console.error("[keys] limits insert error", limErr.message);
    }

    await audit("api_key.created", { id: created.id, name: created.name }, ip);
    return json(200, { key: created, secret: rawKey });
  }

  // GET /keys/:id
  const idMatch = path.match(/^\/([0-9a-f-]{36})$/i);
  if (event.httpMethod === "GET" && idMatch) {
    const id = idMatch[1];
    const { data: key, error } = await supabase
      .from("api_keys")
      .select("id,name,key_prefix,allowed_models,enforced_model,is_active,expires_at,created_at,last_used_at")
      .eq("id", id)
      .maybeSingle();
    if (error) return json(500, { error: error.message });
    if (!key) return json(404, { error: "Not found" });
    const { data: limits } = await supabase.from("api_key_limits").select("*").eq("api_key_id", id);
    return json(200, { key: { ...key, limits: limits || [] } });
  }

  // PATCH /keys/:id
  if (event.httpMethod === "PATCH" && idMatch) {
    const id = idMatch[1];
    const body = parseBody(event);
    const patch = {};
    if (typeof body.name === "string") patch.name = body.name.trim().slice(0, 200);
    if (Array.isArray(body.allowed_models)) patch.allowed_models = body.allowed_models;
    else if (body.allowed_models === null) patch.allowed_models = null;
    if (body.enforced_model !== undefined) patch.enforced_model = body.enforced_model || null;
    if (typeof body.is_active === "boolean") patch.is_active = body.is_active;
    if (body.expires_at !== undefined) patch.expires_at = body.expires_at || null;

    if (Object.keys(patch).length > 0) {
      const { error } = await supabase.from("api_keys").update(patch).eq("id", id);
      if (error) return json(500, { error: error.message });
    }

    if (Array.isArray(body.limits)) {
      const limits = sanitizeLimits(body.limits);
      await supabase.from("api_key_limits").delete().eq("api_key_id", id);
      if (limits.length > 0) {
        const rows = limits.map((l) => ({ ...l, api_key_id: id }));
        const { error: limErr } = await supabase.from("api_key_limits").insert(rows);
        if (limErr) return json(500, { error: limErr.message });
      }
    }

    await audit("api_key.updated", { id, patch }, ip);
    return json(200, { ok: true });
  }

  // DELETE /keys/:id
  if (event.httpMethod === "DELETE" && idMatch) {
    const id = idMatch[1];
    const { error } = await supabase.from("api_keys").delete().eq("id", id);
    if (error) return json(500, { error: error.message });
    await audit("api_key.deleted", { id }, ip);
    return json(200, { ok: true });
  }

  // POST /keys/:id/rotate
  const rotateMatch = path.match(/^\/([0-9a-f-]{36})\/rotate$/i);
  if (event.httpMethod === "POST" && rotateMatch) {
    const id = rotateMatch[1];
    const rawKey = generateApiKey();
    const { data: updated, error } = await supabase
      .from("api_keys")
      .update({ key_prefix: keyPrefix(rawKey), key_hash: hashApiKey(rawKey) })
      .eq("id", id)
      .select("*")
      .single();
    if (error) return json(500, { error: error.message });
    await audit("api_key.rotated", { id }, ip);
    return json(200, { key: updated, secret: rawKey });
  }

  return json(404, { error: "Not found" });
};

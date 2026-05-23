const { getSupabase, requireAuth, json } = require("./_lib/shared");

exports.handler = async (event) => {
  const claims = await requireAuth(event);
  if (!claims) return json(401, { error: "Unauthorized" });
  const supabase = getSupabase();
  const params = event.queryStringParameters || {};

  const limit = Math.min(parseInt(params.limit || "50", 10) || 50, 200);
  const offset = Math.max(parseInt(params.offset || "0", 10) || 0, 0);

  let query = supabase
    .from("request_logs")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (params.api_key_id) query = query.eq("api_key_id", params.api_key_id);
  if (params.model) query = query.eq("model", params.model);
  if (params.status) query = query.eq("status", params.status);
  if (params.endpoint) query = query.eq("endpoint", params.endpoint);
  if (params.status_code) query = query.eq("status_code", parseInt(params.status_code, 10));
  if (params.since) query = query.gte("created_at", params.since);
  if (params.until) query = query.lte("created_at", params.until);

  const { data, error, count } = await query;
  if (error) return json(500, { error: error.message });

  // Join in key names for display.
  const keyIds = Array.from(new Set((data || []).map((r) => r.api_key_id).filter(Boolean)));
  let keyMap = {};
  if (keyIds.length > 0) {
    const { data: keys } = await supabase.from("api_keys").select("id,name,key_prefix").in("id", keyIds);
    for (const k of keys || []) keyMap[k.id] = k;
  }
  const rows = (data || []).map((r) => ({
    ...r,
    api_key_name: keyMap[r.api_key_id]?.name || null,
    api_key_prefix: keyMap[r.api_key_id]?.key_prefix || null,
  }));

  return json(200, { logs: rows, total: count || 0, limit, offset });
};

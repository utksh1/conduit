const { getSupabase, requireAuth, json } = require("./_lib/shared");

exports.handler = async (event) => {
  const claims = await requireAuth(event);
  if (!claims) return json(401, { error: "Unauthorized" });
  const supabase = getSupabase();
  const params = event.queryStringParameters || {};
  const limit = Math.min(parseInt(params.limit || "100", 10) || 100, 500);
  const offset = Math.max(parseInt(params.offset || "0", 10) || 0, 0);

  const { data, error, count } = await supabase
    .from("audit_logs")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) return json(500, { error: error.message });
  return json(200, { entries: data || [], total: count || 0, limit, offset });
};

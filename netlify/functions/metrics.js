const { getSupabase, requireAuth, json } = require("./_lib/shared");

// In-memory aggregation since we don't want Postgres time-series CTEs spread
// across multiple round-trips. Fine for the visible-page size of logs.
function bucketize(rows, sinceMs, bucketMs) {
  const buckets = new Map();
  for (const r of rows) {
    const t = new Date(r.created_at).getTime();
    const key = Math.floor((t - sinceMs) / bucketMs);
    if (!buckets.has(key)) {
      buckets.set(key, {
        bucket_start: new Date(sinceMs + key * bucketMs).toISOString(),
        requests: 0,
        success: 0,
        error: 0,
        rate_limited: 0,
        input_tokens: 0,
        output_tokens: 0,
      });
    }
    const b = buckets.get(key);
    b.requests += 1;
    if (r.status === "success") b.success += 1;
    else if (r.status === "rate_limited") b.rate_limited += 1;
    else b.error += 1;
    b.input_tokens += r.input_tokens || 0;
    b.output_tokens += r.output_tokens || 0;
  }
  return Array.from(buckets.values()).sort((a, b) =>
    a.bucket_start.localeCompare(b.bucket_start),
  );
}

exports.handler = async (event) => {
  const claims = await requireAuth(event);
  if (!claims) return json(401, { error: "Unauthorized" });
  const supabase = getSupabase();
  const params = event.queryStringParameters || {};

  const windowHours = Math.min(parseInt(params.hours || "24", 10) || 24, 24 * 30);
  const sinceMs = Date.now() - windowHours * 60 * 60 * 1000;
  const since = new Date(sinceMs).toISOString();
  const bucketMs = windowHours <= 6 ? 5 * 60 * 1000 : windowHours <= 48 ? 60 * 60 * 1000 : 6 * 60 * 60 * 1000;

  let query = supabase
    .from("request_logs")
    .select("created_at,status,model,input_tokens,output_tokens,api_key_id")
    .gte("created_at", since)
    .order("created_at", { ascending: true });
  if (params.api_key_id) query = query.eq("api_key_id", params.api_key_id);

  const { data, error } = await query;
  if (error) return json(500, { error: error.message });
  const rows = data || [];

  const totals = {
    requests: rows.length,
    success: rows.filter((r) => r.status === "success").length,
    error: rows.filter((r) => r.status === "error").length,
    rate_limited: rows.filter((r) => r.status === "rate_limited").length,
    auth_failed: rows.filter((r) => r.status === "auth_failed").length,
    input_tokens: rows.reduce((s, r) => s + (r.input_tokens || 0), 0),
    output_tokens: rows.reduce((s, r) => s + (r.output_tokens || 0), 0),
  };

  const byModel = {};
  for (const r of rows) {
    const m = r.model || "unknown";
    byModel[m] = (byModel[m] || 0) + 1;
  }
  const modelBreakdown = Object.entries(byModel)
    .map(([model, count]) => ({ model, count }))
    .sort((a, b) => b.count - a.count);

  const series = bucketize(rows, sinceMs, bucketMs);

  return json(200, {
    window_hours: windowHours,
    totals,
    series,
    model_breakdown: modelBreakdown,
  });
};

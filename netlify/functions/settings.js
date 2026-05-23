const {
  getSupabase,
  hashPassword,
  verifyPassword,
  requireAuth,
  json,
  parseBody,
  clientIp,
  audit,
} = require("./_lib/shared");

exports.handler = async (event) => {
  const claims = await requireAuth(event);
  if (!claims) return json(401, { error: "Unauthorized" });
  const supabase = getSupabase();
  const ip = clientIp(event);

  if (event.httpMethod === "GET") {
    const { data, error } = await supabase
      .from("dashboard_settings")
      .select("session_ttl_minutes,ip_allowlist,updated_at")
      .eq("id", 1)
      .maybeSingle();
    if (error) return json(500, { error: error.message });
    return json(200, { settings: data || {} });
  }

  if (event.httpMethod === "PATCH") {
    const body = parseBody(event);
    const patch = { updated_at: new Date().toISOString() };
    if (typeof body.session_ttl_minutes === "number" && body.session_ttl_minutes > 0) {
      patch.session_ttl_minutes = Math.min(body.session_ttl_minutes, 60 * 24 * 30);
    }
    if (Array.isArray(body.ip_allowlist)) {
      patch.ip_allowlist = body.ip_allowlist.filter((s) => typeof s === "string");
    }

    if (body.new_password) {
      if (!body.current_password) return json(400, { error: "Current password required" });
      const { data, error } = await supabase
        .from("dashboard_settings")
        .select("password_hash")
        .eq("id", 1)
        .maybeSingle();
      if (error) return json(500, { error: error.message });
      if (!data || !verifyPassword(body.current_password, data.password_hash)) {
        return json(401, { error: "Current password incorrect" });
      }
      if (typeof body.new_password !== "string" || body.new_password.length < 8) {
        return json(400, { error: "New password must be at least 8 characters." });
      }
      patch.password_hash = hashPassword(body.new_password);
    }

    const { error } = await supabase.from("dashboard_settings").update(patch).eq("id", 1);
    if (error) return json(500, { error: error.message });
    await audit("settings.updated", { fields: Object.keys(patch) }, ip);
    return json(200, { ok: true });
  }

  return json(405, { error: "Method not allowed" });
};

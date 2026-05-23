const { getSupabase, isEnabled } = require("./supabase");

/**
 * Calls chatgpt.check_and_reserve. Returns:
 *   { ok: true, reservationId } — proceed with the upstream call.
 *   { ok: false, failingLimits } — caller should 429.
 *   { ok: true, reservationId: null } — Supabase not configured / legacy key (no metering).
 *   { ok: false, error } — DB error; caller decides fail-open vs fail-closed.
 */
async function reserve(keyId, model, estInput, estOutput) {
  if (!keyId || !isEnabled()) return { ok: true, reservationId: null };

  const supabase = getSupabase();
  if (!supabase) return { ok: true, reservationId: null };

  const { data, error } = await supabase.rpc("check_and_reserve", {
    p_key_id: keyId,
    p_model: model || null,
    p_est_input: Math.max(0, Math.floor(estInput || 0)),
    p_est_output: Math.max(0, Math.floor(estOutput || 0)),
  });

  if (error) return { ok: false, error };
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { ok: true, reservationId: null };
  if (!row.ok) return { ok: false, failingLimits: row.failing_limits || [] };
  return { ok: true, reservationId: row.reservation_id };
}

async function finalize(reservationId, actualInput, actualOutput) {
  if (!reservationId || !isEnabled()) return;
  const supabase = getSupabase();
  if (!supabase) return;
  await supabase.rpc("finalize_consume", {
    p_reservation_id: reservationId,
    p_actual_input: Math.max(0, Math.floor(actualInput || 0)),
    p_actual_output: Math.max(0, Math.floor(actualOutput || 0)),
  });
}

async function logRequest(entry) {
  if (!isEnabled()) return;
  const supabase = getSupabase();
  if (!supabase) return;
  await supabase.from("request_logs").insert(entry);
}

module.exports = { reserve, finalize, logRequest };

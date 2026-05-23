-- ============================================================================
-- chatgpt-to-api dashboard schema
-- ============================================================================
-- Lives in its own `chatgpt` schema, isolated from codex-lb's `public` tables.
-- Service-role-only access — anon role gets nothing. All admin traffic flows
-- through Netlify Functions which hold the service role key.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS chatgpt;

-- Lock anon out at the schema level. We re-grant USAGE to service_role below.
REVOKE ALL ON SCHEMA chatgpt FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA chatgpt TO service_role;

-- ============================================================================
-- Tables
-- ============================================================================

CREATE TABLE chatgpt.dashboard_settings (
  id                   INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  password_hash        TEXT,                                   -- NULL = first-run; UI shows /setup
  session_ttl_minutes  INT NOT NULL DEFAULT 720,
  ip_allowlist         TEXT[],
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO chatgpt.dashboard_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE chatgpt.api_keys (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 TEXT NOT NULL,
  key_prefix           TEXT NOT NULL,                          -- first ~12 chars, shown in lists
  key_hash             TEXT NOT NULL,                          -- argon2id hash of the full key
  allowed_models       TEXT[],                                 -- NULL/empty = any model
  enforced_model       TEXT,                                   -- if set, overrides client model param
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at           TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at         TIMESTAMPTZ
);

CREATE INDEX api_keys_active_idx ON chatgpt.api_keys (is_active, expires_at);
CREATE INDEX api_keys_prefix_idx ON chatgpt.api_keys (key_prefix);

CREATE TABLE chatgpt.api_key_limits (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id           UUID NOT NULL REFERENCES chatgpt.api_keys (id) ON DELETE CASCADE,
  limit_type           TEXT NOT NULL CHECK (limit_type IN ('requests','input_tokens','output_tokens','total_tokens')),
  limit_window         INTERVAL NOT NULL,
  max_value            BIGINT NOT NULL CHECK (max_value > 0),
  current_value        BIGINT NOT NULL DEFAULT 0,
  reset_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  model_filter         TEXT,                                   -- NULL = applies to all models
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX api_key_limits_by_key ON chatgpt.api_key_limits (api_key_id, model_filter);

CREATE TABLE chatgpt.limit_reservations (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id           UUID NOT NULL REFERENCES chatgpt.api_keys (id) ON DELETE CASCADE,
  model                TEXT,
  deltas               JSONB NOT NULL,                         -- {"limit_id":<delta>,...} for refund-on-crash
  reserved_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at           TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '5 minutes'
);

CREATE INDEX limit_reservations_expires ON chatgpt.limit_reservations (expires_at);

CREATE TABLE chatgpt.request_logs (
  id                   BIGSERIAL PRIMARY KEY,
  api_key_id           UUID REFERENCES chatgpt.api_keys (id) ON DELETE SET NULL,
  endpoint             TEXT NOT NULL,                          -- '/v1/chat/completions' | '/v1/responses' | ...
  model                TEXT,
  status_code          INT,
  status               TEXT,                                   -- 'success' | 'error' | 'rate_limited' | 'auth_failed'
  error_code           TEXT,
  error_message        TEXT,
  input_tokens         INT NOT NULL DEFAULT 0,                 -- tiktoken estimate (ChatGPT Web returns 0)
  output_tokens        INT NOT NULL DEFAULT 0,
  total_tokens         INT NOT NULL DEFAULT 0,
  latency_ms           INT,
  streaming            BOOLEAN NOT NULL DEFAULT FALSE,
  client_ip            INET,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX request_logs_created_idx ON chatgpt.request_logs (created_at DESC);
CREATE INDEX request_logs_key_created_idx ON chatgpt.request_logs (api_key_id, created_at DESC);
CREATE INDEX request_logs_model_created_idx ON chatgpt.request_logs (model, created_at DESC);

CREATE TABLE chatgpt.audit_logs (
  id                   BIGSERIAL PRIMARY KEY,
  action               TEXT NOT NULL,                          -- 'api_key.created' | 'settings.updated' | ...
  details              JSONB,
  actor_ip             INET,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX audit_logs_created_idx ON chatgpt.audit_logs (created_at DESC);

-- ============================================================================
-- RPC: check_and_reserve
-- Atomically (1) lazy-resets expired windows, (2) verifies every matching
-- limit can absorb the request's deltas, (3) deducts. Returns a reservation
-- id for finalize. All-or-nothing — on rejection, nothing is deducted.
-- ============================================================================

CREATE OR REPLACE FUNCTION chatgpt.check_and_reserve(
  p_key_id      UUID,
  p_model       TEXT,
  p_est_input   INT,
  p_est_output  INT
) RETURNS TABLE (
  reservation_id UUID,
  ok BOOLEAN,
  failing_limits JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = chatgpt, pg_temp
AS $$
DECLARE
  v_est_total   INT := p_est_input + p_est_output;
  v_failing     JSONB := '[]'::jsonb;
  v_deltas      JSONB := '{}'::jsonb;
  v_reservation UUID;
  r             RECORD;
BEGIN
  -- 1. Reset expired windows + lock the rows for this key/model.
  FOR r IN
    UPDATE chatgpt.api_key_limits
    SET
      current_value = CASE WHEN reset_at < NOW() THEN 0 ELSE current_value END,
      reset_at      = CASE WHEN reset_at < NOW() THEN NOW() + limit_window ELSE reset_at END
    WHERE api_key_id = p_key_id
      AND (model_filter IS NULL OR model_filter = p_model)
    RETURNING id, limit_type, current_value, max_value, model_filter
  LOOP
    -- 2. Compute the would-be new value for each row.
    DECLARE
      v_delta BIGINT := CASE r.limit_type
        WHEN 'requests'       THEN 1
        WHEN 'input_tokens'   THEN p_est_input
        WHEN 'output_tokens'  THEN p_est_output
        WHEN 'total_tokens'   THEN v_est_total
      END;
    BEGIN
      IF r.current_value + v_delta > r.max_value THEN
        v_failing := v_failing || jsonb_build_object(
          'limit_id',     r.id,
          'limit_type',   r.limit_type,
          'model_filter', r.model_filter,
          'current',      r.current_value,
          'max',          r.max_value,
          'attempted',    v_delta
        );
      ELSE
        v_deltas := v_deltas || jsonb_build_object(r.id::text, v_delta);
      END IF;
    END;
  END LOOP;

  IF jsonb_array_length(v_failing) > 0 THEN
    -- Roll back implicit row updates from the UPDATE above by raising and
    -- caller wrapping in a transaction? Actually no — the reset is fine to
    -- keep, the increment is what we skipped. The current_value didn't change
    -- because we only SET reset/current to themselves when not expired.
    RETURN QUERY SELECT NULL::UUID, FALSE, v_failing;
    RETURN;
  END IF;

  -- 3. All limits pass — apply the deltas.
  UPDATE chatgpt.api_key_limits
  SET current_value = current_value + ((v_deltas ->> id::text)::BIGINT)
  WHERE id IN (SELECT (jsonb_each_text(v_deltas)).key::UUID);

  INSERT INTO chatgpt.limit_reservations (api_key_id, model, deltas)
  VALUES (p_key_id, p_model, v_deltas)
  RETURNING id INTO v_reservation;

  -- 4. Touch last_used_at on the api_key.
  UPDATE chatgpt.api_keys SET last_used_at = NOW() WHERE id = p_key_id;

  RETURN QUERY SELECT v_reservation, TRUE, '[]'::JSONB;
END;
$$;

-- ============================================================================
-- RPC: finalize_consume
-- Adjusts the reserved deltas to match the actual token counts. Refunds
-- overestimates; charges underestimates (but never retroactively rejects).
-- ============================================================================

CREATE OR REPLACE FUNCTION chatgpt.finalize_consume(
  p_reservation_id UUID,
  p_actual_input   INT,
  p_actual_output  INT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = chatgpt, pg_temp
AS $$
DECLARE
  v_deltas   JSONB;
  v_actual   INT;
  r          RECORD;
  v_limit    RECORD;
  v_adjust   BIGINT;
BEGIN
  SELECT deltas INTO v_deltas
  FROM chatgpt.limit_reservations
  WHERE id = p_reservation_id;

  IF v_deltas IS NULL THEN
    RETURN; -- Already finalized or never existed.
  END IF;

  FOR r IN SELECT key::UUID AS limit_id, value::TEXT AS est_delta_text
           FROM jsonb_each_text(v_deltas)
  LOOP
    SELECT limit_type INTO v_limit FROM chatgpt.api_key_limits WHERE id = r.limit_id;
    IF NOT FOUND THEN CONTINUE; END IF;

    v_actual := CASE v_limit.limit_type
      WHEN 'requests'      THEN 1
      WHEN 'input_tokens'  THEN p_actual_input
      WHEN 'output_tokens' THEN p_actual_output
      WHEN 'total_tokens'  THEN p_actual_input + p_actual_output
    END;

    v_adjust := v_actual - r.est_delta_text::BIGINT;

    IF v_adjust <> 0 THEN
      UPDATE chatgpt.api_key_limits
      SET current_value = GREATEST(0, LEAST(max_value, current_value + v_adjust))
      WHERE id = r.limit_id;
    END IF;
  END LOOP;

  DELETE FROM chatgpt.limit_reservations WHERE id = p_reservation_id;
END;
$$;

-- ============================================================================
-- RPC: sweep_reservations
-- Refunds anything still outstanding past its TTL (crashed requests).
-- ============================================================================

CREATE OR REPLACE FUNCTION chatgpt.sweep_reservations() RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = chatgpt, pg_temp
AS $$
DECLARE
  v_count   INT := 0;
  v_res     RECORD;
  r         RECORD;
BEGIN
  FOR v_res IN
    SELECT id, deltas FROM chatgpt.limit_reservations WHERE expires_at < NOW()
  LOOP
    FOR r IN SELECT key::UUID AS limit_id, value::TEXT AS delta_text
             FROM jsonb_each_text(v_res.deltas)
    LOOP
      UPDATE chatgpt.api_key_limits
      SET current_value = GREATEST(0, current_value - r.delta_text::BIGINT)
      WHERE id = r.limit_id;
    END LOOP;
    DELETE FROM chatgpt.limit_reservations WHERE id = v_res.id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

-- ============================================================================
-- Permissions: only service_role can do anything in this schema.
-- ============================================================================

GRANT ALL ON ALL TABLES IN SCHEMA chatgpt TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA chatgpt TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA chatgpt TO service_role;

REVOKE EXECUTE ON FUNCTION chatgpt.check_and_reserve(UUID, TEXT, INT, INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION chatgpt.finalize_consume(UUID, INT, INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION chatgpt.sweep_reservations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION chatgpt.check_and_reserve(UUID, TEXT, INT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION chatgpt.finalize_consume(UUID, INT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION chatgpt.sweep_reservations() TO service_role;

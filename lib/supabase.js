const { createClient } = require("@supabase/supabase-js");

let client = null;

function getSupabase() {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: "chatgpt" },
  });
  return client;
}

function isEnabled() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

module.exports = { getSupabase, isEnabled };

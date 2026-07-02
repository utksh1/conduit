const { getSupabase } = require("../lib/supabase");
const { generateApiKey, keyPrefix, hashKey } = require("../lib/hash");
const dotenv = require("dotenv");
dotenv.config();

async function main() {
  const supabase = getSupabase();
  if (!supabase) {
    console.error("Supabase not enabled/configured in env");
    process.exit(1);
  }

  const rawKey = generateApiKey();
  const insert = {
    name: "test-temp-key-june-24",
    key_prefix: keyPrefix(rawKey),
    key_hash: hashKey(rawKey),
    allowed_models: null,
    enforced_model: null,
    is_active: true,
    expires_at: null,
  };

  console.log("Generating and inserting key to DB...");
  const { data, error } = await supabase
    .from("api_keys")
    .insert(insert)
    .select("*")
    .single();

  if (error) {
    console.error("Error creating key:", error);
    process.exit(1);
  }

  console.log("Success! Created new API key in DB:");
  console.log("-----------------------------------------");
  console.log("Key ID:  ", data.id);
  console.log("Name:    ", data.name);
  console.log("Prefix:  ", data.key_prefix);
  console.log("Raw Key: ", rawKey);
  console.log("-----------------------------------------");
  console.log("Use this Raw Key as Bearer token to test.");
}

main().catch(console.error);

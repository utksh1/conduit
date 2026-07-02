const { createClient } = require("@supabase/supabase-js");
const dotenv = require("dotenv");
dotenv.config();

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Supabase env vars missing in .env");
  process.exit(1);
}

const supabase = createClient(url, key, {
  db: { schema: "chatgpt" }
});

async function main() {
  // Get total count
  const { count: totalCount, error: totalError } = await supabase
    .from("request_logs")
    .select("*", { count: "exact", head: true });

  if (totalError) {
    console.error("Error fetching total logs:", totalError);
    process.exit(1);
  }

  // Get count older than 7 days (June 17, 2026)
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  
  const { data, error } = await supabase
    .from("request_logs")
    .select("*")
    .eq("endpoint", "/v1/responses")
    .order("created_at", { ascending: false })
    .limit(5);

  if (error) {
    console.error("Error fetching logs:", error);
    process.exit(1);
  }

  console.log("Recent /v1/responses logs:");
  console.log(JSON.stringify(data, null, 2));
}

main().catch(console.error);

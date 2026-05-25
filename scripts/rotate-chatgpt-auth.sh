#!/usr/bin/env bash
# Rotate ChatGPT auth on Render: switch from static access token to
# auto-refreshing session-token path.
#
# Usage:
#   chmod +x scripts/rotate-chatgpt-auth.sh
#   scripts/rotate-chatgpt-auth.sh
#
# You'll be prompted for the session token (paste it; input is hidden).
# Optionally also for the full Cookie jar — leave blank to skip.

set -euo pipefail

SVC=srv-d88hdmjeo5us73ftus30

RENDER_TOKEN="$(awk -F': ' '/^[[:space:]]*(api_key|api_token|token|key):/{gsub(/["\x27]/,"",$2); print $2; exit}' ~/.render/cli.yaml 2>/dev/null || true)"
if [ -z "${RENDER_TOKEN:-}" ]; then
  echo "ERROR: Could not read Render API token from ~/.render/cli.yaml" >&2
  echo "Either log in with the render CLI, or export RENDER_TOKEN=rnd_... before running." >&2
  exit 1
fi

echo "Render token: ${RENDER_TOKEN:0:8}... (from ~/.render/cli.yaml)"
echo

# Prompt for session token (hidden input)
echo "Paste __Secure-next-auth.session-token value, then press Enter."
echo "(input is hidden; nothing will echo)"
read -rs SESSION_TOKEN
echo

if [ -z "$SESSION_TOKEN" ]; then
  echo "ERROR: empty session token" >&2
  exit 1
fi
echo "Session token captured (${#SESSION_TOKEN} chars)."
echo

# Optional: full cookie jar
echo "Optional: paste the full Cookie header from chatgpt.com (or leave blank)."
echo "(useful if Sentinel still 401s with just the session token)"
read -rs COOKIE_JAR
echo
if [ -n "$COOKIE_JAR" ]; then
  echo "Cookie jar captured (${#COOKIE_JAR} chars)."
fi
echo

# 1. Delete the static access token — its presence shortcircuits auto-refresh
echo "[1/3] Deleting CHATGPT_ACCESS_TOKEN..."
HTTP_CODE=$(curl -sw "%{http_code}" -o /tmp/rotate-out.json -X DELETE \
  -H "Authorization: Bearer $RENDER_TOKEN" \
  "https://api.render.com/v1/services/$SVC/env-vars/CHATGPT_ACCESS_TOKEN")
echo "    HTTP $HTTP_CODE"
# 204 = deleted, 404 = wasn't set, both OK

# 2. Upsert CHATGPT_SESSION_TOKEN
echo "[2/3] Setting CHATGPT_SESSION_TOKEN..."
HTTP_CODE=$(jq -n --arg v "$SESSION_TOKEN" '{value:$v}' | curl -sw "%{http_code}" -o /tmp/rotate-out.json -X PUT \
  -H "Authorization: Bearer $RENDER_TOKEN" \
  -H "Content-Type: application/json" \
  --data @- \
  "https://api.render.com/v1/services/$SVC/env-vars/CHATGPT_SESSION_TOKEN")
echo "    HTTP $HTTP_CODE"
if [ "$HTTP_CODE" != "200" ] && [ "$HTTP_CODE" != "201" ]; then
  echo "    FAILED — response:" >&2
  cat /tmp/rotate-out.json >&2
  exit 1
fi

# 3. Upsert CHATGPT_COOKIES if provided
if [ -n "$COOKIE_JAR" ]; then
  echo "[3/3] Setting CHATGPT_COOKIES..."
  HTTP_CODE=$(jq -n --arg v "$COOKIE_JAR" '{value:$v}' | curl -sw "%{http_code}" -o /tmp/rotate-out.json -X PUT \
    -H "Authorization: Bearer $RENDER_TOKEN" \
    -H "Content-Type: application/json" \
    --data @- \
    "https://api.render.com/v1/services/$SVC/env-vars/CHATGPT_COOKIES")
  echo "    HTTP $HTTP_CODE"
  if [ "$HTTP_CODE" != "200" ] && [ "$HTTP_CODE" != "201" ]; then
    echo "    FAILED — response:" >&2
    cat /tmp/rotate-out.json >&2
    exit 1
  fi
else
  echo "[3/3] Skipping CHATGPT_COOKIES (not provided)"
fi

rm -f /tmp/rotate-out.json
unset SESSION_TOKEN COOKIE_JAR

echo
echo "Done. Render will auto-deploy in ~30s."
echo "Watch the deploy:  render deploys list $SVC -o json --confirm | python3 -m json.tool | head -30"
echo "Tail logs:         render logs -r $SVC --type app --tail -o text --confirm"

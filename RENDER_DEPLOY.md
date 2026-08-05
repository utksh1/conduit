# 🚀 Render Deployment - Conduit

## Quick Deploy

1. **Go to Render Dashboard**: https://dashboard.render.com
2. **Delete old service** (if exists)
3. **New Web Service** → Connect `utksh1/conduit` repo
4. **Configure**:
   - Name: `conduit`
   - Environment: `Rust`
   - Build: `cargo build --release`
   - Start: `./target/release/conduit`
   - Plan: Starter ($7/mo) or Free

## Environment Variables (Required)

Set these in Render dashboard:

```bash
CHATGPT_SESSION_TOKEN=<your-token>
CHATGPT_ACCESS_TOKEN=<your-access-token>
CHATGPT_REFRESH_TOKEN=<your-refresh-token>
PROXY_API_KEY=<generate-a-new-32-character-or-longer-application-secret>
JWT_SECRET=<generate-a-new-32-character-or-longer-jwt-secret>
ADMIN_PASSWORD=<set-a-strong-dashboard-password>
PORT=3040
HOST=0.0.0.0
ALLOWED_DIRECTORIES=/tmp
ALLOWED_SHELL_COMMANDS=ls,cat,grep,echo,pwd
```

## Vercel Dashboard

Deploy the `dashboard` directory as a separate Vercel project. Set its production environment variables to:

```bash
RENDER_BACKEND_URL=https://conduit-mlxk.onrender.com
PROXY_API_KEY=<the-same-application-key-configured-in-Render>
```

Do not set `JWT_SECRET`, `ADMIN_PASSWORD`, ChatGPT credentials, or the Render account API key in Vercel. The Vercel functions validate the dashboard JWT with Render, then inject `PROXY_API_KEY` while proxying `/v1/*` requests.

## After Deployment

Your API will be at: `https://conduit-<random>.onrender.com`

**Test it:**
```bash
curl https://your-app.onrender.com/health
```

**Use it:**
```bash
curl https://your-app.onrender.com/v1/chat/completions \
  -H "Authorization: Bearer <your-application-api-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

## Application and Dashboard Secrets

`PROXY_API_KEY`, `JWT_SECRET`, and `ADMIN_PASSWORD` are required for startup.

- `PROXY_API_KEY` protects every `/v1/*` endpoint. Keep it server-side in Vercel and use it only for trusted direct API clients.
- `JWT_SECRET` signs dashboard sessions. Keep it stable across redeploys.
- `ADMIN_PASSWORD` is the dashboard sign-in password. It is verified in memory, so the dashboard remains recoverable even when free Render's local SQLite data resets.

Use this application key for direct OpenAI-compatible requests:
```
Authorization: Bearer <your-application-api-key>
```

Do not use the Render account API key as any application secret.

## Repository

✅ Code pushed to: https://github.com/utksh1/conduit
✅ Ready for Render deployment

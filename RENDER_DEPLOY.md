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
PROXY_API_KEY=rnd_t5fV8FUbylox0gOW72yTUm4rNZ8T
PORT=3040
HOST=0.0.0.0
ALLOWED_DIRECTORIES=/tmp
ALLOWED_SHELL_COMMANDS=ls,cat,grep,echo,pwd
```

## After Deployment

Your API will be at: `https://conduit-<random>.onrender.com`

**Test it:**
```bash
curl https://your-app.onrender.com/health
```

**Use it:**
```bash
curl https://your-app.onrender.com/v1/chat/completions \
  -H "Authorization: Bearer rnd_t5fV8FUbylox0gOW72yTUm4rNZ8T" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

## API Key

**Production Key**: `rnd_t5fV8FUbylox0gOW72yTUm4rNZ8T`

Use in all requests:
```
Authorization: Bearer rnd_t5fV8FUbylox0gOW72yTUm4rNZ8T
```

## Repository

✅ Code pushed to: https://github.com/utksh1/conduit
✅ Ready for Render deployment

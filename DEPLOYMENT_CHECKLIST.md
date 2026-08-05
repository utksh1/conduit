# Deployment Checklist

## ✅ Completed
- [x] Code pushed to GitHub (utksh1/conduit)
- [x] Gitignore updated
- [x] Heuristic tool parser implemented
- [x] All features verified locally
- [x] Deployment guide created
- [ ] Set `PROXY_API_KEY`, `JWT_SECRET`, and `ADMIN_PASSWORD` as Render secrets

## 🚀 Deploy to Render

### 1. Access Render Dashboard
Go to: https://dashboard.render.com

### 2. Remove Old Service
- Find existing "conduit" or "chatgpt-proxy" service
- Click "Delete Service"
- Confirm deletion

### 3. Create New Web Service
- Click "New +" → "Web Service"
- Select "Connect a repository"
- Choose: `utksh1/conduit`
- Click "Connect"

### 4. Configure Service
```
Name: conduit
Environment: Rust
Branch: main
Build Command: cargo build --release
Start Command: ./target/release/conduit
Plan: Starter ($7/mo) or Free
```

### 5. Add Environment Variables
Click "Advanced" → "Add Environment Variable":

```bash
CHATGPT_SESSION_TOKEN=<copy-from-.env>
CHATGPT_ACCESS_TOKEN=<copy-from-.env>
CHATGPT_REFRESH_TOKEN=<copy-from-.env>
PROXY_API_KEY=<32-character-or-longer-application-secret>
JWT_SECRET=<32-character-or-longer-jwt-secret>
ADMIN_PASSWORD=<strong-dashboard-password>
PORT=3040
HOST=0.0.0.0
ALLOWED_DIRECTORIES=/tmp
ALLOWED_SHELL_COMMANDS=ls,cat,grep,echo,pwd,find,wc
```

### 6. Deploy
- Click "Create Web Service"
- Wait 5-10 minutes for build
- Check logs for "Starting server on 0.0.0.0:3040"

### 7. Test Deployment
```bash
# Health check
curl https://your-app.onrender.com/health

# Test API
curl https://your-app.onrender.com/v1/chat/completions \
  -H "Authorization: Bearer <your-application-api-key>" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"Hello"}]}'
```

## 📝 Post-Deployment

Your API endpoint: `https://conduit-<random>.onrender.com`

Save this URL and use it with:
- Cursor IDE
- Continue extension
- Custom scripts
- Any OpenAI-compatible client

**Application API Key**: `PROXY_API_KEY` protects every `/v1/*` route. Keep it server-side in Vercel and never reuse the Render account API key.

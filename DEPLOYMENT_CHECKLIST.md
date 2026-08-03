# Deployment Checklist

## ✅ Completed
- [x] Code pushed to GitHub (utksh1/conduit)
- [x] Gitignore updated
- [x] Heuristic tool parser implemented
- [x] All features verified locally
- [x] Deployment guide created
- [x] Production API key set: `rnd_t5fV8FUbylox0gOW72yTUm4rNZ8T`

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
PROXY_API_KEY=rnd_t5fV8FUbylox0gOW72yTUm4rNZ8T
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
  -H "Authorization: Bearer rnd_t5fV8FUbylox0gOW72yTUm4rNZ8T" \
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

**API Key**: `rnd_t5fV8FUbylox0gOW72yTUm4rNZ8T`

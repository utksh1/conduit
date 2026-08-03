# Render Deployment Guide

## Environment Variables to Set in Render Dashboard

```
CHATGPT_SESSION_TOKEN=<your-session-token>
CHATGPT_ACCESS_TOKEN=<your-access-token>
CHATGPT_REFRESH_TOKEN=<your-refresh-token>
PROXY_API_KEY=rnd_t5fV8FUbylox0gOW72yTUm4rNZ8T
PORT=3040
HOST=0.0.0.0
ALLOWED_DIRECTORIES=/tmp
ALLOWED_SHELL_COMMANDS=ls,cat,grep,echo,pwd
```

## Deployment Steps

1. Go to https://dashboard.render.com
2. Delete old Conduit service if exists
3. Click "New +" → "Web Service"
4. Connect GitHub repository: `utksh1/conduit`
5. Configure:
   - Name: `conduit`
   - Environment: `Rust`
   - Build Command: `cargo build --release`
   - Start Command: `./target/release/conduit`
   - Instance Type: Free or Starter
6. Add environment variables above
7. Click "Create Web Service"

## API Endpoint

After deployment: `https://conduit-<random>.onrender.com`

Test with:
```bash
curl https://your-app.onrender.com/health
```

## API Key

Use this key in Authorization header:
```
Authorization: Bearer rnd_t5fV8FUbylox0gOW72yTUm4rNZ8T
```

import requests

def test_refresh():
    url = "https://auth0.openai.com/oauth/token"
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0"
    }
    data = {
        "redirect_uri": "com.openai.chat://auth0.openai.com/ios/com.openai.chat/callback",
        "grant_type": "refresh_token",
        "client_id": "pdlLIX2Y72MIl2rhLhTE9VV9bN905kBh",
        "refresh_token": "test"
    }
    
    try:
        resp = requests.post(url, headers=headers, json=data, timeout=5)
        print(f"Status: {resp.status_code}")
        print(f"Body: {resp.text}")
    except Exception as e:
        print(e)

test_refresh()

import requests

url = "http://localhost:3040/v1/chat/completions"
headers = {
    "Authorization": "Bearer sk-cond-049ecfc9c0bdece1d2528ae23b326b4cd351122266bb5ff08eb2b578e08e0e22",
    "Content-Type": "application/json"
}
data = {
    "model": "gpt-4o",
    "messages": [
        {"role": "user", "content": "Generate an image using DALL-E with the following prompt: \"A cute cat\""}
    ]
}

resp = requests.post(url, headers=headers, json=data)
print(resp.json())

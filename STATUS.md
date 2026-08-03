# Conduit - ChatGPT to OpenAI API Proxy

## ✅ Verified Working Features

### All Models
- gpt-5.6-sol ✓
- gpt-5.6-terra ✓
- gpt-5.6-luna ✓
- gpt-5.5 ✓
- gpt-5.5-pro ✓
- gpt-4o ✓
- o3-mini ✓
- o1-mini ✓

### Chain of Thought Reasoning
All models support step-by-step reasoning when prompted:
- **gpt-5.6-sol**: Shows detailed calculation steps
- **gpt-5.6-terra**: Explains reasoning process
- **o3-mini**: Native reasoning model with detailed thought process
- **o1-mini**: Native reasoning model

### Other Features
- ✅ Streaming responses (SSE)
- ✅ OpenAI-compatible API
- ✅ Session management
- ✅ Proof-of-work solving
- ✅ Multiple conversation support

## ⚠️ Known Limitations

### Tool Calling
Tool calling infrastructure is implemented but **unreliable**:
- Heuristic parser extracts tool calls from natural language
- ChatGPT web interface prefers conversational responses
- For reliable function calling, use official OpenAI API

## Quick Start

```bash
cd ~/Documents/conduit
./target/release/conduit
```

Server: `http://localhost:3040`

## API Key

Test key: `sk-test-conduit-12345`

Create more keys via the dashboard or database.

## Configuration

Edit `.env`:
- `ALLOWED_DIRECTORIES` - Filesystem tool access
- `ALLOWED_SHELL_COMMANDS` - Shell tool whitelist
- `PORT` - Server port (default: 3040)

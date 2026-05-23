import { useEffect, useRef, useState } from "react";
import { Send, Trash2, AlertCircle } from "lucide-react";
import { Card, Input, Select, Button, Label, Spinner } from "@/components/ui";

type Role = "user" | "assistant";
interface Message {
  role: Role;
  content: string;
}

const PROXY_BASE = "https://chatgpt.utksh.in";
const MODELS = ["gpt-5-5", "gpt-5-5-instant", "gpt-5-5-thinking", "gpt-5-4-thinking", "gpt-5-3-instant", "gpt-5-2-instant", "gpt-5-2-thinking", "o3"];

export default function Chat() {
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(MODELS[0]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  function clear() {
    abortRef.current?.abort();
    setMessages([]);
    setError(null);
    setStreaming(false);
  }

  async function send() {
    const text = input.trim();
    if (!text || !apiKey.trim() || streaming) return;
    setError(null);
    setInput("");
    const next: Message[] = [...messages, { role: "user", content: text }, { role: "assistant", content: "" }];
    setMessages(next);
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`${PROXY_BASE}/v1/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey.trim()}`,
        },
        body: JSON.stringify({
          model,
          stream: true,
          messages: next.slice(0, -1).map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (!res.ok || !res.body) {
        const body = await res.text().catch(() => "");
        throw new Error(`${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 240)}` : ""}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let acc = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            const json = JSON.parse(payload);
            const delta = json?.choices?.[0]?.delta?.content;
            if (typeof delta === "string" && delta.length > 0) {
              acc += delta;
              setMessages((prev) => {
                const copy = prev.slice();
                copy[copy.length - 1] = { role: "assistant", content: acc };
                return copy;
              });
            }
          } catch {
            // ignore non-JSON keepalives
          }
        }
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setError((e as Error).message || "Request failed");
      setMessages((prev) => {
        const copy = prev.slice();
        if (copy.length && copy[copy.length - 1].role === "assistant" && copy[copy.length - 1].content === "") {
          copy.pop();
        }
        return copy;
      });
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Chat</h1>
        <p className="text-sm text-[var(--color-fg-muted)] mt-1">
          Quick scratchpad against the proxy. Nothing is stored — refresh wipes the conversation.
        </p>
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_220px] gap-3">
          <div>
            <Label>API key</Label>
            <Input
              type="password"
              autoComplete="off"
              placeholder="sk-cgpt-..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>
          <div>
            <Label>Model</Label>
            <Select value={model} onChange={(e) => setModel(e.target.value)}>
              {MODELS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </Select>
          </div>
        </div>
      </Card>

      <Card className="p-0 flex flex-col" style={{ height: "calc(100vh - 360px)", minHeight: 360 }}>
        <div ref={scrollerRef} className="flex-1 overflow-y-auto p-5 space-y-4">
          {messages.length === 0 && (
            <div className="text-sm text-[var(--color-fg-muted)] text-center py-10">
              Paste an API key above and start chatting.
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <div
                className={
                  m.role === "user"
                    ? "max-w-[80%] rounded-lg bg-[var(--color-accent)] text-[var(--color-accent-fg)] px-4 py-2 text-sm whitespace-pre-wrap"
                    : "max-w-[80%] rounded-lg bg-[var(--color-surface-2)] text-[var(--color-fg)] px-4 py-2 text-sm whitespace-pre-wrap"
                }
              >
                {m.content || (streaming && i === messages.length - 1 ? <Spinner size={14} /> : null)}
              </div>
            </div>
          ))}
          {error && (
            <div className="flex items-start gap-2 rounded-md border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 p-3 text-xs text-[var(--color-danger)]">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <span className="break-all">{error}</span>
            </div>
          )}
        </div>

        <div className="border-t p-3 flex items-end gap-2">
          <textarea
            className="flex-1 resize-none rounded-md border bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
            rows={2}
            placeholder={apiKey ? "Message... (Enter to send, Shift+Enter for newline)" : "Add an API key first"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={!apiKey || streaming}
          />
          <div className="flex flex-col gap-2">
            <Button onClick={send} disabled={!apiKey || !input.trim() || streaming} size="sm">
              {streaming ? <Spinner size={14} /> : <Send size={14} />}
              {streaming ? "Streaming" : "Send"}
            </Button>
            <Button variant="ghost" onClick={clear} disabled={messages.length === 0 && !streaming} size="sm">
              <Trash2 size={14} />
              Clear
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

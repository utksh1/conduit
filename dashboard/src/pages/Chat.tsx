import { useEffect, useRef, useState } from "react";
import { AlertCircle, Image as ImageIcon, Send, Trash2 } from "lucide-react";
import { Button, Card, Select, Spinner } from "@/components/ui";
import ProtectedImage from "@/components/ProtectedImage";
import { dashboardFetch } from "@/lib/dashboard-fetch";

type Role = "user" | "assistant";

interface Message {
  role: Role;
  content: string;
}

const DEFAULT_MODELS = [
  "gpt-5-5",
  "gpt-5-5-instant",
  "gpt-5-5-thinking",
  "gpt-5-4-thinking",
  "gpt-5-3-instant",
  "gpt-5-2-instant",
  "gpt-5-2-thinking",
  "o3",
];

function renderContent(content: string) {
  if (!content) return null;
  const parts = content.split(/(!\[.*?\]\(.*?\))/g);

  return (
    <>
      {parts.map((part, index) => {
        const match = part.match(/!\[(.*?)\]\((.*?)\)/);
        if (match) {
          return (
            <ProtectedImage
              key={index}
              src={match[2]}
              alt={match[1]}
              className="max-w-full rounded mt-2 mb-2 border border-[var(--color-border)] block"
            />
          );
        }
        return <span key={index}>{part}</span>;
      })}
    </>
  );
}

export default function Chat() {
  const [models, setModels] = useState(DEFAULT_MODELS);
  const [model, setModel] = useState(DEFAULT_MODELS[0]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [imageMode, setImageMode] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dashboardFetch("/v1/models")
      .then((response) => response.json())
      .then((data) => {
        if (!data || !Array.isArray(data.data)) return;

        const fetchedModels = data.data
          .map((item: unknown) => (typeof item === "object" && item && "id" in item ? item.id : null))
          .filter((item: unknown): item is string => typeof item === "string");

        if (fetchedModels.length > 0) {
          setModels(fetchedModels);
          setModel((current) => fetchedModels.includes(current) ? current : fetchedModels[0]);
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    scrollerRef.current?.scrollTo({
      top: scrollerRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  function clear() {
    abortRef.current?.abort();
    setMessages([]);
    setError(null);
    setStreaming(false);
  }

  async function send() {
    let text = input.trim();
    if (!text || streaming) return;

    setError(null);
    setInput("");
    if (imageMode) text = `Generate an image of ${text}`;

    const next: Message[] = [
      ...messages,
      { role: "user", content: text },
      { role: "assistant", content: "" },
    ];
    setMessages(next);
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await dashboardFetch("/v1/chat/completions", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          stream: true,
          messages: next.slice(0, -1).map((message) => ({
            role: message.role,
            content: message.content,
          })),
        }),
      });

      if (!response.ok || !response.body) {
        const body = await response.text().catch(() => "");
        throw new Error(
          `${response.status} ${response.statusText}${body ? `: ${body.slice(0, 240)}` : ""}`,
        );
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const payload = line.trim().startsWith("data:") ? line.trim().slice(5).trim() : "";
          if (!payload || payload === "[DONE]") continue;

          try {
            const chunk = JSON.parse(payload);
            const delta = chunk?.choices?.[0]?.delta?.content;
            if (typeof delta === "string" && delta.length > 0) {
              accumulated += delta;
              setMessages((previous) => {
                const copy = previous.slice();
                copy[copy.length - 1] = { role: "assistant", content: accumulated };
                return copy;
              });
            }
          } catch {
            // Ignore non-JSON keepalive events.
          }
        }
      }
    } catch (requestError) {
      if ((requestError as Error).name === "AbortError") return;
      setError((requestError as Error).message || "Request failed");
      setMessages((previous) => {
        const copy = previous.slice();
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

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Chat</h1>
        <p className="text-sm text-[var(--color-fg-muted)] mt-1">
          Quick scratchpad against the proxy. Nothing is stored. Refreshing clears the conversation.
        </p>
      </div>

      <Card className="p-4">
        <div>
          <label className="text-sm font-medium">Model</label>
          <Select value={model} onChange={(event) => setModel(event.target.value)} className="mt-2">
            {models.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </Select>
        </div>
      </Card>

      <Card className="p-0 flex flex-col" style={{ height: "calc(100vh - 360px)", minHeight: 360 }}>
        <div ref={scrollerRef} className="flex-1 overflow-y-auto p-5 space-y-4">
          {messages.length === 0 && (
            <div className="text-sm text-[var(--color-fg-muted)] text-center py-10">
              Start a conversation.
            </div>
          )}
          {messages.map((message, index) => (
            <div key={index} className={message.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <div
                className={
                  message.role === "user"
                    ? "max-w-[80%] rounded-lg bg-[var(--color-accent)] text-[var(--color-accent-fg)] px-4 py-2 text-sm whitespace-pre-wrap"
                    : "max-w-[80%] rounded-lg bg-[var(--color-surface-2)] text-[var(--color-fg)] px-4 py-2 text-sm whitespace-pre-wrap"
                }
              >
                {message.content
                  ? renderContent(message.content)
                  : streaming && index === messages.length - 1
                    ? <Spinner size={14} />
                    : null}
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
          <Button
            variant={imageMode ? "primary" : "ghost"}
            className={`shrink-0 self-end mb-0 ${imageMode ? "bg-purple-600 hover:bg-purple-700 text-white border-transparent" : ""}`}
            onClick={() => setImageMode(!imageMode)}
            title="Toggle image generation mode"
          >
            <ImageIcon size={18} />
          </Button>
          <textarea
            className="flex-1 resize-none rounded-md border bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
            rows={2}
            placeholder={imageMode ? "Describe the image you want to generate..." : "Message... (Enter to send, Shift+Enter for newline)"}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={onKeyDown}
            disabled={streaming}
          />
          <div className="flex flex-col gap-2">
            <Button onClick={send} disabled={!input.trim() || streaming} size="sm">
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

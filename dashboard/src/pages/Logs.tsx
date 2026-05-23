import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, Input, Select, Button, Spinner, Badge } from "@/components/ui";
import { StatusBadge } from "./Dashboard";

interface LogRow {
  id: number;
  endpoint: string;
  model: string | null;
  status: string;
  status_code: number;
  api_key_name: string | null;
  api_key_prefix: string | null;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number | null;
  streaming: boolean;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  client_ip: string | null;
}

export default function Logs() {
  const [status, setStatus] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [model, setModel] = useState("");
  const [offset, setOffset] = useState(0);
  const limit = 50;
  const [expanded, setExpanded] = useState<number | null>(null);

  const params = new URLSearchParams();
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  if (status) params.set("status", status);
  if (endpoint) params.set("endpoint", endpoint);
  if (model) params.set("model", model);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["logs", { status, endpoint, model, offset }],
    queryFn: () => api<{ logs: LogRow[]; total: number; limit: number; offset: number }>(`/logs?${params}`),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Request Logs</h1>
        <p className="text-sm text-[var(--color-fg-muted)] mt-1">All requests proxied through the gateway.</p>
      </div>

      <Card>
        <div className="flex flex-wrap gap-3 mb-4">
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setOffset(0); }} className="w-40">
            <option value="">All statuses</option>
            <option value="success">Success</option>
            <option value="error">Error</option>
            <option value="rate_limited">Rate limited</option>
            <option value="auth_failed">Auth failed</option>
          </Select>
          <Select value={endpoint} onChange={(e) => { setEndpoint(e.target.value); setOffset(0); }} className="w-56">
            <option value="">All endpoints</option>
            <option value="/v1/chat/completions">/v1/chat/completions</option>
            <option value="/v1/responses">/v1/responses</option>
          </Select>
          <Input placeholder="Filter by model…" value={model} onChange={(e) => { setModel(e.target.value); setOffset(0); }} className="w-56" />
          {isFetching && <div className="flex items-center"><Spinner /></div>}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center p-6"><Spinner /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-[var(--color-fg-muted)] border-b">
                  <th className="pb-2 pr-3 font-medium">Time</th>
                  <th className="pb-2 pr-3 font-medium">Endpoint</th>
                  <th className="pb-2 pr-3 font-medium">Model</th>
                  <th className="pb-2 pr-3 font-medium">Key</th>
                  <th className="pb-2 pr-3 font-medium">Tokens</th>
                  <th className="pb-2 pr-3 font-medium">Status</th>
                  <th className="pb-2 font-medium text-right">Latency</th>
                </tr>
              </thead>
              <tbody>
                {(data?.logs || []).map((l) => (
                  <>
                    <tr
                      key={l.id}
                      className="border-b border-[var(--color-border)]/50 last:border-0 cursor-pointer hover:bg-[var(--color-surface-2)]/40"
                      onClick={() => setExpanded(expanded === l.id ? null : l.id)}
                    >
                      <td className="py-2 pr-3 text-[var(--color-fg-muted)]">{new Date(l.created_at).toLocaleString()}</td>
                      <td className="py-2 pr-3 font-mono text-xs">{l.endpoint}</td>
                      <td className="py-2 pr-3 text-xs">{l.model || "—"}</td>
                      <td className="py-2 pr-3 text-xs">{l.api_key_name || <span className="text-[var(--color-fg-muted)]">deleted</span>}</td>
                      <td className="py-2 pr-3 text-xs text-[var(--color-fg-muted)]">{l.input_tokens}/{l.output_tokens}</td>
                      <td className="py-2 pr-3">
                        <StatusBadge status={l.status} code={l.status_code} />
                        {l.streaming && <Badge tone="default">stream</Badge>}
                      </td>
                      <td className="py-2 text-right text-[var(--color-fg-muted)]">{l.latency_ms ? `${l.latency_ms}ms` : "—"}</td>
                    </tr>
                    {expanded === l.id && (
                      <tr key={`${l.id}-detail`} className="bg-[var(--color-bg)]/60">
                        <td colSpan={7} className="px-3 py-3 text-xs">
                          <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                            <div><span className="text-[var(--color-fg-muted)]">Client IP:</span> {l.client_ip || "—"}</div>
                            <div><span className="text-[var(--color-fg-muted)]">Key prefix:</span> <span className="font-mono">{l.api_key_prefix || "—"}</span></div>
                            <div><span className="text-[var(--color-fg-muted)]">Error code:</span> {l.error_code || "—"}</div>
                            <div><span className="text-[var(--color-fg-muted)]">Total tokens:</span> {l.input_tokens + l.output_tokens}</div>
                          </div>
                          {l.error_message && (
                            <pre className="mt-2 whitespace-pre-wrap rounded bg-[var(--color-surface-2)] p-2 text-[11px]">{l.error_message}</pre>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                ))}
                {!data?.logs.length && (
                  <tr><td colSpan={7} className="py-6 text-center text-[var(--color-fg-muted)]">No matching requests.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 flex items-center justify-between text-sm">
          <div className="text-[var(--color-fg-muted)]">
            {data ? `Showing ${data.offset + 1}–${Math.min(data.offset + data.logs.length, data.total)} of ${data.total}` : "—"}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>Prev</Button>
            <Button variant="secondary" size="sm" disabled={!data || offset + limit >= data.total} onClick={() => setOffset(offset + limit)}>Next</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, Badge, Spinner } from "@/components/ui";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

interface MetricsResponse {
  window_hours: number;
  totals: {
    requests: number;
    success: number;
    error: number;
    rate_limited: number;
    auth_failed: number;
    input_tokens: number;
    output_tokens: number;
  };
  series: { bucket_start: string; requests: number; success: number; error: number; rate_limited: number }[];
  model_breakdown: { model: string; count: number }[];
}

interface LogsResponse {
  logs: {
    id: number;
    endpoint: string;
    model: string | null;
    status: string;
    status_code: number;
    api_key_name: string | null;
    latency_ms: number | null;
    created_at: string;
  }[];
}

function formatNum(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(n);
}

export default function Dashboard() {
  const metrics = useQuery({
    queryKey: ["metrics", 24],
    queryFn: () => api<MetricsResponse>("/metrics?hours=24"),
    refetchInterval: 15_000,
  });
  const recent = useQuery({
    queryKey: ["logs", { limit: 20 }],
    queryFn: () => api<LogsResponse>("/logs?limit=20"),
    refetchInterval: 15_000,
  });

  if (metrics.isLoading) return <div className="flex items-center justify-center p-12"><Spinner size={24} /></div>;
  const m = metrics.data;
  if (!m) return null;
  const errRate = m.totals.requests ? (m.totals.error + m.totals.rate_limited) / m.totals.requests : 0;
  const topModel = m.model_breakdown[0]?.model || "—";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Overview</h1>
        <p className="text-sm text-[var(--color-fg-muted)] mt-1">Last 24 hours</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Requests" value={formatNum(m.totals.requests)} />
        <Stat label="Success" value={formatNum(m.totals.success)} tone="success" />
        <Stat label="Errors + 429s" value={formatNum(m.totals.error + m.totals.rate_limited)} tone={errRate > 0.1 ? "danger" : "default"} />
        <Stat label="Top model" value={topModel} />
        <Stat label="Input tokens" value={formatNum(m.totals.input_tokens)} sub="estimated" />
        <Stat label="Output tokens" value={formatNum(m.totals.output_tokens)} sub="estimated" />
        <Stat label="Error rate" value={(errRate * 100).toFixed(1) + "%"} tone={errRate > 0.1 ? "danger" : "default"} />
        <Stat label="Auth failures" value={formatNum(m.totals.auth_failed)} tone={m.totals.auth_failed > 0 ? "warn" : "default"} />
      </div>

      <Card>
        <h2 className="text-sm font-medium mb-4">Requests over time</h2>
        <div className="h-64">
          <ResponsiveContainer>
            <AreaChart data={m.series}>
              <defs>
                <linearGradient id="g-req" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="oklch(0.72 0.18 250)" stopOpacity={0.45} />
                  <stop offset="95%" stopColor="oklch(0.72 0.18 250)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis
                dataKey="bucket_start"
                tickFormatter={(v) => new Date(v).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                stroke="var(--color-fg-muted)"
                fontSize={11}
              />
              <YAxis stroke="var(--color-fg-muted)" fontSize={11} />
              <Tooltip
                contentStyle={{ background: "var(--color-surface-2)", border: "1px solid var(--color-border)", borderRadius: 6 }}
                labelFormatter={(v) => new Date(v).toLocaleString()}
              />
              <Area type="monotone" dataKey="requests" stroke="oklch(0.72 0.18 250)" fill="url(#g-req)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card>
        <h2 className="text-sm font-medium mb-4">Recent requests</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[var(--color-fg-muted)] border-b">
                <th className="pb-2 font-medium">Time</th>
                <th className="pb-2 font-medium">Endpoint</th>
                <th className="pb-2 font-medium">Model</th>
                <th className="pb-2 font-medium">Key</th>
                <th className="pb-2 font-medium">Status</th>
                <th className="pb-2 font-medium text-right">Latency</th>
              </tr>
            </thead>
            <tbody>
              {(recent.data?.logs || []).map((l) => (
                <tr key={l.id} className="border-b border-[var(--color-border)]/50 last:border-0">
                  <td className="py-2 text-[var(--color-fg-muted)]">{new Date(l.created_at).toLocaleTimeString()}</td>
                  <td className="py-2 font-mono text-xs">{l.endpoint}</td>
                  <td className="py-2 text-xs">{l.model || "—"}</td>
                  <td className="py-2 text-xs">{l.api_key_name || "—"}</td>
                  <td className="py-2"><StatusBadge status={l.status} code={l.status_code} /></td>
                  <td className="py-2 text-right text-[var(--color-fg-muted)]">{l.latency_ms ? `${l.latency_ms}ms` : "—"}</td>
                </tr>
              ))}
              {!recent.data?.logs.length && (
                <tr><td colSpan={6} className="py-6 text-center text-[var(--color-fg-muted)]">No requests yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Stat({ label, value, sub, tone = "default" }: { label: string; value: string; sub?: string; tone?: "default" | "success" | "danger" | "warn" }) {
  const colors = {
    default: "text-[var(--color-fg)]",
    success: "text-[var(--color-success)]",
    danger: "text-[var(--color-danger)]",
    warn: "text-[var(--color-warn)]",
  };
  return (
    <Card className="p-4">
      <div className="text-xs text-[var(--color-fg-muted)]">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${colors[tone]}`}>{value}</div>
      {sub && <div className="text-[10px] text-[var(--color-fg-muted)] uppercase tracking-wide mt-0.5">{sub}</div>}
    </Card>
  );
}

export function StatusBadge({ status, code }: { status: string; code: number }) {
  if (status === "success") return <Badge tone="success">{code}</Badge>;
  if (status === "rate_limited") return <Badge tone="warn">429</Badge>;
  if (status === "auth_failed") return <Badge tone="danger">{code}</Badge>;
  return <Badge tone="danger">{code}</Badge>;
}

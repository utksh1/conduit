import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, Spinner, Button } from "@/components/ui";

interface AuditRow {
  id: number;
  action: string;
  details: unknown;
  actor_ip: string | null;
  created_at: string;
}

export default function Audit() {
  const [offset, setOffset] = useState(0);
  const limit = 100;

  const { data, isLoading } = useQuery({
    queryKey: ["audit", offset],
    queryFn: () =>
      api<{ entries: AuditRow[]; total: number; offset: number; limit: number }>(
        `/audit?limit=${limit}&offset=${offset}`,
      ),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Audit Log</h1>
        <p className="text-sm text-[var(--color-fg-muted)] mt-1">Administrative actions on the console.</p>
      </div>

      <Card>
        {isLoading ? (
          <div className="flex items-center justify-center p-6"><Spinner /></div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[var(--color-fg-muted)] border-b">
                <th className="pb-2 pr-3 font-medium">Time</th>
                <th className="pb-2 pr-3 font-medium">Action</th>
                <th className="pb-2 pr-3 font-medium">IP</th>
                <th className="pb-2 font-medium">Details</th>
              </tr>
            </thead>
            <tbody>
              {(data?.entries || []).map((e) => (
                <tr key={e.id} className="border-b border-[var(--color-border)]/50 last:border-0">
                  <td className="py-2 pr-3 text-[var(--color-fg-muted)] whitespace-nowrap">{new Date(e.created_at).toLocaleString()}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{e.action}</td>
                  <td className="py-2 pr-3 text-xs">{e.actor_ip || "—"}</td>
                  <td className="py-2 text-xs"><pre className="whitespace-pre-wrap font-mono">{e.details ? JSON.stringify(e.details) : "—"}</pre></td>
                </tr>
              ))}
              {!data?.entries.length && (
                <tr><td colSpan={4} className="py-6 text-center text-[var(--color-fg-muted)]">No audit entries yet.</td></tr>
              )}
            </tbody>
          </table>
        )}
        <div className="mt-4 flex items-center justify-between text-sm">
          <div className="text-[var(--color-fg-muted)]">
            {data ? `Showing ${data.offset + 1}–${Math.min(data.offset + data.entries.length, data.total)} of ${data.total}` : "—"}
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

import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button, Card, Input, Label, Badge, Modal, Spinner, Select } from "@/components/ui";
import { Copy, Trash2, RotateCw, Plus } from "lucide-react";

interface ApiKeyLimit {
  id?: string;
  limit_type: "requests" | "input_tokens" | "output_tokens" | "total_tokens";
  limit_window: string; // postgres interval e.g. "1 hour"
  max_value: number;
  model_filter: string | null;
}

interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  allowed_models: string[] | null;
  enforced_model: string | null;
  is_active: boolean;
  expires_at: string | null;
  created_at: string;
  last_used_at: string | null;
  limits?: ApiKeyLimit[];
}

const WINDOWS = [
  { label: "per minute", value: "1 minute" },
  { label: "per hour", value: "1 hour" },
  { label: "per day", value: "1 day" },
  { label: "per week", value: "7 days" },
  { label: "per month", value: "30 days" },
];

const LIMIT_TYPES = [
  { label: "Requests", value: "requests" },
  { label: "Input tokens", value: "input_tokens" },
  { label: "Output tokens", value: "output_tokens" },
  { label: "Total tokens", value: "total_tokens" },
];

export default function ApiKeys() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["keys"],
    queryFn: () => api<{ keys: ApiKey[] }>("/keys"),
  });

  const [creating, setCreating] = useState(false);
  const [revealed, setRevealed] = useState<{ key: ApiKey; secret: string } | null>(null);
  const [editing, setEditing] = useState<ApiKey | null>(null);

  const deleteMut = useMutation({
    mutationFn: (id: string) => api(`/keys/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["keys"] }),
  });

  const rotateMut = useMutation({
    mutationFn: (id: string) => api<{ key: ApiKey; secret: string }>(`/keys/${id}/rotate`, { method: "POST" }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["keys"] });
      setRevealed(res);
    },
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      api(`/keys/${id}`, { method: "PATCH", body: JSON.stringify({ is_active }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["keys"] }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">API Keys</h1>
          <p className="text-sm text-[var(--color-fg-muted)] mt-1">Issue and revoke keys for callers.</p>
        </div>
        <Button onClick={() => setCreating(true)}><Plus size={16} /> New key</Button>
      </div>

      <Card>
        {isLoading ? (
          <div className="flex items-center justify-center p-6"><Spinner /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-[var(--color-fg-muted)] border-b">
                  <th className="pb-2 pr-3 font-medium">Name</th>
                  <th className="pb-2 pr-3 font-medium">Prefix</th>
                  <th className="pb-2 pr-3 font-medium">Models</th>
                  <th className="pb-2 pr-3 font-medium">Limits</th>
                  <th className="pb-2 pr-3 font-medium">Last used</th>
                  <th className="pb-2 pr-3 font-medium">Status</th>
                  <th className="pb-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(data?.keys || []).map((k) => (
                  <tr key={k.id} className="border-b border-[var(--color-border)]/50 last:border-0 hover:bg-[var(--color-surface-2)]/40">
                    <td className="py-3 pr-3 font-medium cursor-pointer" onClick={() => setEditing(k)}>{k.name}</td>
                    <td className="py-3 pr-3 font-mono text-xs">{k.key_prefix}…</td>
                    <td className="py-3 pr-3 text-xs">
                      {k.enforced_model
                        ? <Badge tone="warn">forced: {k.enforced_model}</Badge>
                        : k.allowed_models?.length
                          ? <span className="text-[var(--color-fg-muted)]">{k.allowed_models.join(", ")}</span>
                          : <span className="text-[var(--color-fg-muted)]">any</span>}
                    </td>
                    <td className="py-3 pr-3 text-xs text-[var(--color-fg-muted)]">{k.limits?.length || 0}</td>
                    <td className="py-3 pr-3 text-xs text-[var(--color-fg-muted)]">{k.last_used_at ? new Date(k.last_used_at).toLocaleString() : "—"}</td>
                    <td className="py-3 pr-3">
                      <button onClick={() => toggleMut.mutate({ id: k.id, is_active: !k.is_active })}>
                        {k.is_active ? <Badge tone="success">active</Badge> : <Badge tone="default">disabled</Badge>}
                      </button>
                    </td>
                    <td className="py-3 text-right">
                      <div className="inline-flex gap-2">
                        <Button variant="ghost" size="sm" onClick={() => rotateMut.mutate(k.id)} title="Rotate"><RotateCw size={14} /></Button>
                        <Button variant="ghost" size="sm" onClick={() => { if (confirm(`Delete key "${k.name}"?`)) deleteMut.mutate(k.id); }} title="Delete"><Trash2 size={14} /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!data?.keys.length && (
                  <tr><td colSpan={7} className="py-6 text-center text-[var(--color-fg-muted)]">No keys yet. Click <em>New key</em> to create one.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <KeyEditor
        open={creating || !!editing}
        mode={creating ? "create" : "edit"}
        initial={editing}
        onClose={() => { setCreating(false); setEditing(null); }}
        onRevealed={setRevealed}
      />
      <RevealModal open={!!revealed} onClose={() => setRevealed(null)} reveal={revealed} />
    </div>
  );
}

function KeyEditor({
  open,
  mode,
  initial,
  onClose,
  onRevealed,
}: {
  open: boolean;
  mode: "create" | "edit";
  initial: ApiKey | null;
  onClose: () => void;
  onRevealed: (r: { key: ApiKey; secret: string }) => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(initial?.name || "");
  const [allowedModels, setAllowedModels] = useState((initial?.allowed_models || []).join(", "));
  const [enforcedModel, setEnforcedModel] = useState(initial?.enforced_model || "");
  const [limits, setLimits] = useState<ApiKeyLimit[]>(initial?.limits || []);
  const [error, setError] = useState<string | null>(null);

  // Reset form when initial changes
  useState(() => {
    setName(initial?.name || "");
    setAllowedModels((initial?.allowed_models || []).join(", "));
    setEnforcedModel(initial?.enforced_model || "");
    setLimits(initial?.limits || []);
  });

  const save = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        name,
        allowed_models: allowedModels.trim() ? allowedModels.split(",").map((s) => s.trim()).filter(Boolean) : null,
        enforced_model: enforcedModel.trim() || null,
        limits,
      };
      if (mode === "create") {
        return api<{ key: ApiKey; secret: string }>("/keys", { method: "POST", body: JSON.stringify(body) });
      }
      await api(`/keys/${initial!.id}`, { method: "PATCH", body: JSON.stringify(body) });
      return null;
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["keys"] });
      if (res) onRevealed(res);
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Failed"),
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    save.mutate();
  };

  const addLimit = () => {
    setLimits([...limits, { limit_type: "requests", limit_window: "1 hour", max_value: 100, model_filter: null }]);
  };
  const updateLimit = (i: number, patch: Partial<ApiKeyLimit>) => {
    setLimits(limits.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  };
  const removeLimit = (i: number) => setLimits(limits.filter((_, idx) => idx !== i));

  return (
    <Modal open={open} onClose={onClose} title={mode === "create" ? "Create API key" : "Edit API key"}>
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </div>

        <div>
          <Label>Allowed models (comma separated, blank = any)</Label>
          <Input
            value={allowedModels}
            onChange={(e) => setAllowedModels(e.target.value)}
            placeholder="gpt-5-5, gpt-5-5-thinking"
          />
        </div>

        <div>
          <Label>Enforced model (overrides client choice)</Label>
          <Input
            value={enforcedModel}
            onChange={(e) => setEnforcedModel(e.target.value)}
            placeholder="leave blank to allow any of the above"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <Label>Rate limits</Label>
            <button type="button" className="text-xs text-[var(--color-accent)] hover:underline" onClick={addLimit}>+ add limit</button>
          </div>
          <div className="space-y-2">
            {limits.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_100px_1fr_auto] gap-2 items-center">
                <Select value={l.limit_type} onChange={(e) => updateLimit(i, { limit_type: e.target.value as ApiKeyLimit["limit_type"] })}>
                  {LIMIT_TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
                <Select value={l.limit_window} onChange={(e) => updateLimit(i, { limit_window: e.target.value })}>
                  {WINDOWS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
                <Input
                  type="number"
                  min="1"
                  value={l.max_value}
                  onChange={(e) => updateLimit(i, { max_value: Number(e.target.value) })}
                />
                <Input
                  placeholder="model filter (blank = all)"
                  value={l.model_filter || ""}
                  onChange={(e) => updateLimit(i, { model_filter: e.target.value || null })}
                />
                <button type="button" className="text-[var(--color-fg-muted)] hover:text-[var(--color-danger)]" onClick={() => removeLimit(i)}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {!limits.length && (
              <div className="text-xs text-[var(--color-fg-muted)] py-2">No rate limits — key has unlimited access.</div>
            )}
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={save.isPending}>{save.isPending ? "Saving…" : mode === "create" ? "Create" : "Save"}</Button>
        </div>
      </form>
    </Modal>
  );
}

function RevealModal({ open, onClose, reveal }: { open: boolean; onClose: () => void; reveal: { key: ApiKey; secret: string } | null }) {
  if (!reveal) return null;
  return (
    <Modal open={open} onClose={onClose} title="Copy your key now">
      <p className="mb-3 text-sm text-[var(--color-fg-muted)]">
        This is the only time the full key will be shown. Store it somewhere safe.
      </p>
      <div className="flex gap-2">
        <Input value={reveal.secret} readOnly className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
        <Button onClick={() => navigator.clipboard.writeText(reveal.secret)}><Copy size={14} /> Copy</Button>
      </div>
      <div className="flex justify-end mt-4">
        <Button variant="secondary" onClick={onClose}>Done</Button>
      </div>
    </Modal>
  );
}

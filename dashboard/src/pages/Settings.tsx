import { useState, type FormEvent, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, Button, Input, Label, Spinner } from "@/components/ui";

interface SettingsResp {
  settings: {
    session_ttl_minutes?: number;
    ip_allowlist?: string[];
    updated_at?: string;
  };
}

export default function Settings() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: () => api<SettingsResp>("/settings"),
  });

  const [ttl, setTtl] = useState("720");
  const [allowlist, setAllowlist] = useState("");
  const [currentPwd, setCurrentPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (data?.settings) {
      setTtl(String(data.settings.session_ttl_minutes || 720));
      setAllowlist((data.settings.ip_allowlist || []).join(", "));
    }
  }, [data]);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api("/settings", { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      setSavedMsg("Saved.");
      setTimeout(() => setSavedMsg(null), 2000);
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : "Failed"),
  });

  const saveGeneral = (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    save.mutate({
      session_ttl_minutes: Number(ttl),
      ip_allowlist: allowlist.split(",").map((s) => s.trim()).filter(Boolean),
    });
  };

  const changePassword = (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (newPwd !== confirmPwd) {
      setErrorMsg("Passwords do not match.");
      return;
    }
    save.mutate(
      { current_password: currentPwd, new_password: newPwd },
      {
        onSuccess: () => {
          setCurrentPwd("");
          setNewPwd("");
          setConfirmPwd("");
        },
      },
    );
  };

  if (isLoading) return <div className="flex items-center justify-center p-12"><Spinner size={24} /></div>;

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-[var(--color-fg-muted)] mt-1">Console-level configuration.</p>
      </div>

      <Card>
        <h2 className="text-sm font-medium mb-4">General</h2>
        <form onSubmit={saveGeneral} className="space-y-4">
          <div>
            <Label>Session TTL (minutes)</Label>
            <Input type="number" min="5" value={ttl} onChange={(e) => setTtl(e.target.value)} />
          </div>
          <div>
            <Label>IP allowlist for dashboard (comma separated, blank = all)</Label>
            <Input value={allowlist} onChange={(e) => setAllowlist(e.target.value)} placeholder="1.2.3.4, 10.0.0.0/24" />
          </div>
          <Button type="submit" disabled={save.isPending}>Save</Button>
        </form>
      </Card>

      <Card>
        <h2 className="text-sm font-medium mb-4">Change password</h2>
        <form onSubmit={changePassword} className="space-y-4">
          <div>
            <Label>Current password</Label>
            <Input type="password" value={currentPwd} onChange={(e) => setCurrentPwd(e.target.value)} required />
          </div>
          <div>
            <Label>New password</Label>
            <Input type="password" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} minLength={8} required />
          </div>
          <div>
            <Label>Confirm new password</Label>
            <Input type="password" value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)} minLength={8} required />
          </div>
          <Button type="submit" disabled={save.isPending}>Change password</Button>
        </form>
      </Card>

      {savedMsg && <div className="text-sm text-[var(--color-success)]">{savedMsg}</div>}
      {errorMsg && <div className="text-sm text-[var(--color-danger)]">{errorMsg}</div>}
    </div>
  );
}

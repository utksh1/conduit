import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-store";
import { Button, Input, Label, Card } from "@/components/ui";

export default function Login({ mode }: { mode: "login" | "setup" }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setToken = useAuth((s) => s.setToken);
  const navigate = useNavigate();

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode === "setup" && password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      const path = mode === "setup" ? "/auth/setup" : "/auth/login";
      const res = await api<{ token: string }>(path, {
        method: "POST",
        body: JSON.stringify({ password }),
        skipAuth: true,
      });
      setToken(res.token);
      navigate("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center p-8">
      <Card className="w-full max-w-sm">
        <h1 className="mb-1 text-xl font-semibold">
          {mode === "setup" ? "First-time setup" : "Sign in"}
        </h1>
        <p className="mb-5 text-sm text-[var(--color-fg-muted)]">
          {mode === "setup"
            ? "Create a password for the admin console."
            : "Enter the admin password."}
        </p>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <Label>Password</Label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              minLength={mode === "setup" ? 8 : 1}
              required
            />
          </div>
          {mode === "setup" && (
            <div>
              <Label>Confirm password</Label>
              <Input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                minLength={8}
                required
              />
            </div>
          )}
          {error && (
            <div className="rounded-md border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]">
              {error}
            </div>
          )}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Working…" : mode === "setup" ? "Create & sign in" : "Sign in"}
          </Button>
        </form>
      </Card>
    </div>
  );
}

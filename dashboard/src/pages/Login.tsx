import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-store";
import { Button, Card, Input, Label } from "@/components/ui";

export default function Login() {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setToken = useAuth((state) => state.setToken);
  const navigate = useNavigate();

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const response = await api<{ token: string }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ password }),
        skipAuth: true,
      });
      setToken(response.token);
      navigate("/dashboard");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Sign in failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center p-8">
      <Card className="w-full max-w-sm">
        <h1 className="mb-1 text-xl font-semibold">Sign in</h1>
        <p className="mb-5 text-sm text-[var(--color-fg-muted)]">Enter the dashboard password.</p>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <Label>Password</Label>
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoFocus
              required
            />
          </div>
          {error && (
            <div className="rounded-md border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]">
              {error}
            </div>
          )}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Working..." : "Sign in"}
          </Button>
        </form>
      </Card>
    </div>
  );
}

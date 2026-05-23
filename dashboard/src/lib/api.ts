import { useAuth } from "./auth-store";

const API_BASE = "/api";

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export async function api<T = unknown>(
  path: string,
  options: RequestInit & { skipAuth?: boolean } = {},
): Promise<T> {
  const { skipAuth, headers, ...rest } = options;
  const token = useAuth.getState().token;
  const finalHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...((headers as Record<string, string>) || {}),
  };
  if (!skipAuth && token) finalHeaders["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...rest, headers: finalHeaders });
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!res.ok) {
    const message =
      (body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string"
        ? (body as { error: string }).error
        : null) || `Request failed with ${res.status}`;
    if (res.status === 401) {
      useAuth.getState().logout();
    }
    throw new ApiError(res.status, message, body);
  }
  return body as T;
}

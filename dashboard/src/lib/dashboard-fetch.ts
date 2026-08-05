import { useAuth } from "./auth-store";

export async function dashboardFetch(path: string, options: RequestInit = {}) {
  const token = useAuth.getState().token;
  if (!token) {
    throw new Error("A dashboard session is required");
  }

  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(path, { ...options, headers });
  if (response.status === 401) {
    useAuth.getState().logout();
  }

  return response;
}

import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-store";
import Layout from "@/components/Layout";
import { Spinner } from "@/components/ui";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import ApiKeys from "@/pages/ApiKeys";
import Logs from "@/pages/Logs";
import Settings from "@/pages/Settings";
import Audit from "@/pages/Audit";

function Root() {
  const token = useAuth((s) => s.token);
  const { data, isLoading } = useQuery({
    queryKey: ["auth-status"],
    queryFn: () => api<{ needsSetup: boolean; authenticated: boolean }>("/auth/status", { skipAuth: !token }),
    refetchOnWindowFocus: false,
    refetchOnMount: true,
  });

  if (isLoading) return <div className="flex h-full items-center justify-center"><Spinner size={24} /></div>;
  if (data?.needsSetup) return <Login mode="setup" />;
  if (!token || !data?.authenticated) return <Login mode="login" />;
  return <Navigate to="/dashboard" replace />;
}

function Protected() {
  const token = useAuth((s) => s.token);
  if (!token) return <Navigate to="/" replace />;
  return <Layout />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Root />} />
        <Route element={<Protected />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/keys" element={<ApiKeys />} />
          <Route path="/logs" element={<Logs />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/audit" element={<Audit />} />
        </Route>
        <Route path="/login" element={<Login mode="login" />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { Activity, KeyRound, ScrollText, Settings as SettingsIcon, Shield, LogOut } from "lucide-react";
import { useAuth } from "@/lib/auth-store";
import clsx from "clsx";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: Activity },
  { to: "/keys", label: "API Keys", icon: KeyRound },
  { to: "/logs", label: "Request Logs", icon: ScrollText },
  { to: "/audit", label: "Audit Log", icon: Shield },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

export default function Layout() {
  const navigate = useNavigate();
  const logout = useAuth((s) => s.logout);

  return (
    <div className="grid h-full grid-cols-[240px_1fr]">
      <aside className="flex flex-col border-r bg-[var(--color-surface)]">
        <div className="px-5 py-5 border-b">
          <div className="text-base font-semibold">chatgpt-to-api</div>
          <div className="text-xs text-[var(--color-fg-muted)] mt-0.5">admin console</div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                clsx(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-[var(--color-surface-2)] text-[var(--color-fg)]"
                    : "text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-surface-2)]",
                )
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t p-3">
          <button
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-surface-2)] transition-colors"
            onClick={() => {
              logout();
              navigate("/login");
            }}
          >
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </aside>
      <main className="overflow-y-auto p-8">
        <Outlet />
      </main>
    </div>
  );
}

import clsx from "clsx";
import type { ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes, HTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

export function Button({
  className,
  variant = "primary",
  size = "md",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "sm" | "md" }) {
  const base = "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
  const sizes = {
    sm: "h-8 px-3 text-sm",
    md: "h-9 px-4 text-sm",
  };
  const variants: Record<ButtonVariant, string> = {
    primary: "bg-[var(--color-accent)] text-[var(--color-accent-fg)] hover:opacity-90",
    secondary: "bg-[var(--color-surface-2)] text-[var(--color-fg)] hover:bg-[var(--color-border)]",
    danger: "bg-[var(--color-danger)] text-white hover:opacity-90",
    ghost: "text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-surface-2)]",
  };
  return <button className={clsx(base, sizes[size], variants[variant], className)} {...props} />;
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={clsx(
        "h-9 w-full rounded-md border bg-[var(--color-surface)] px-3 text-sm outline-none focus:border-[var(--color-accent)]",
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={clsx(
        "h-9 w-full rounded-md border bg-[var(--color-surface)] px-3 text-sm outline-none focus:border-[var(--color-accent)]",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export function Card({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx(
        "rounded-lg border bg-[var(--color-surface)] p-5",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function Label({ className, children, ...props }: HTMLAttributes<HTMLLabelElement>) {
  return (
    <label className={clsx("block text-xs font-medium text-[var(--color-fg-muted)] mb-1.5", className)} {...props}>
      {children}
    </label>
  );
}

export function Badge({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "success" | "danger" | "warn" }) {
  const tones = {
    default: "bg-[var(--color-surface-2)] text-[var(--color-fg-muted)]",
    success: "bg-[var(--color-success)]/15 text-[var(--color-success)]",
    danger: "bg-[var(--color-danger)]/15 text-[var(--color-danger)]",
    warn: "bg-[var(--color-warn)]/15 text-[var(--color-warn)]",
  };
  return (
    <span className={clsx("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium", tones[tone])}>
      {children}
    </span>
  );
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-lg border bg-[var(--color-surface)] p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button className="text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]" onClick={onClose}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <div
      className="inline-block animate-spin rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-accent)]"
      style={{ width: size, height: size }}
    />
  );
}

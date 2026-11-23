import { useEffect, useRef, type ReactNode } from "react";
import { Icon } from "./icons";
import { Button } from "./controls";
import { useSession } from "../store/session";
import { useToasts } from "../store/toast";

/** Collapsible section; its open/closed state is remembered per `id`. */
export function Section({ id, title, summary, children, defaultOpen = true, actions }: { id: string; title: ReactNode; summary?: ReactNode; children: ReactNode; defaultOpen?: boolean; actions?: ReactNode }) {
  const open = useSession((s) => s.open[id] ?? defaultOpen);
  const toggle = useSession((s) => s.toggle);
  const bodyId = `sec-${id}`;
  return (
    <section className="section">
      <div className="row" style={{ gap: 0, paddingRight: actions ? 10 : 0 }}>
        <button type="button" className="section-head" aria-expanded={open} aria-controls={bodyId} onClick={() => toggle(id, defaultOpen)} style={{ flex: 1 }}>
          <Icon name="chevron" size={18} className="chev" />
          <h3>{title}</h3>
          {summary && <span className="summary">{summary}</span>}
        </button>
        {actions}
      </div>
      {open && (
        <div id={bodyId} className="section-body">
          {children}
        </div>
      )}
    </section>
  );
}

export function Card({ title, children, actions, className = "" }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-title">
          {typeof title === "string" ? <h2>{title}</h2> : title}
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Notice({ kind = "info", children, onClose }: { kind?: "info" | "warn" | "error" | "ok"; children: ReactNode; onClose?: () => void }) {
  return (
    <div className={`notice ${kind}`} role={kind === "error" ? "alert" : "status"}>
      <Icon name={kind === "ok" ? "check" : kind === "info" ? "info" : "warn"} />
      <div className="grow">{children}</div>
      {onClose && <Button icon="x" small variant="ghost" label="Dismiss" onClick={onClose} />}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs, label }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: ReactNode; count?: number }[]; label: string }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button key={t.value} type="button" role="tab" className="tab" aria-selected={t.value === value} onClick={() => onChange(t.value)}>
          {t.label}
          {t.count !== undefined && <span className="count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Native <dialog> (focus trapping and Escape handling come from the browser). */
export function Dialog({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="dialog" onClose={onClose} aria-label={title} style={wide ? { width: "min(900px, calc(100vw - 32px))" } : undefined}>
      {open && (
        <>
          <div className="dialog-head">
            <h2>{title}</h2>
            <Button icon="x" variant="ghost" label="Close" onClick={onClose} />
          </div>
          <div className="dialog-body">{children}</div>
          {footer && <div className="dialog-foot">{footer}</div>}
        </>
      )}
    </dialog>
  );
}

export function Toasts() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  return (
    <div className="toasts" aria-live="polite" aria-atomic="false">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} role={t.kind === "error" ? "alert" : "status"}>
          <Icon name={t.kind === "error" ? "warn" : "check"} />
          <span className="grow">{t.text}</span>
          {t.action && (
            <Button
              small
              variant="gold"
              onClick={() => {
                t.action!.run();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </Button>
          )}
          <Button icon="x" small variant="ghost" label="Dismiss" onClick={() => dismiss(t.id)} />
        </div>
      ))}
    </div>
  );
}

export function Stat({ label, value, sub }: { label: ReactNode; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

export function Bar({ value, max, kind = "" }: { value: number; max: number; kind?: "" | "hp" | "sp" }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className={`bar ${kind}`} role="presentation">
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

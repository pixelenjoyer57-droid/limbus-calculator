// Form controls. Every control has a visible label, large touch targets and,
// where useful, an inline hint or a non-blocking warning.
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Icon } from "./icons";
import { useSettings } from "../store/settings";

export function Button({
  children, onClick, variant = "", small, icon, label, disabled, type = "button", title, className = "", block,
}: {
  children?: ReactNode;
  onClick?: () => void;
  variant?: "" | "primary" | "gold" | "ghost" | "danger";
  small?: boolean;
  icon?: string;
  label?: string;
  disabled?: boolean;
  type?: "button" | "submit";
  title?: string;
  className?: string;
  block?: boolean;
}) {
  const iconOnly = icon && !children;
  return (
    <button
      type={type}
      className={`btn ${variant} ${small ? "small" : ""} ${iconOnly ? "icon" : ""} ${block ? "block" : ""} ${className}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={iconOnly ? label ?? title : label}
      title={title ?? (iconOnly ? label : undefined)}
    >
      {icon && <Icon name={icon} size={small ? 17 : 19} />}
      {children}
    </button>
  );
}

/** Small "?" button that reveals an explanation in place (no hover needed, works on phones). */
export function Info({ children, label = "More info" }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <button type="button" className="tip-btn" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} aria-label={label} title={label}>
        ?
      </button>
      {open && (
        <span id={id} className="tip" role="note" style={{ display: "block", flexBasis: "100%" }}>
          {children}
        </span>
      )}
    </>
  );
}

export function Field({
  label, hint, warn, info, children, className = "", htmlFor,
}: {
  label: ReactNode;
  hint?: ReactNode;
  warn?: ReactNode;
  info?: ReactNode;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  const showHelp = useSettings((s) => s.showHelp);
  return (
    <div className={`field ${className}`}>
      <span className="label" style={{ flexWrap: "wrap" }}>
        {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : label}
        {info && <Info label={`About ${typeof label === "string" ? label : "this field"}`}>{info}</Info>}
      </span>
      {children}
      {hint && showHelp && <span className="hint">{hint}</span>}
      {warn && (
        <span className="warn" role="status">
          <Icon name="warn" size={15} /> <span>{warn}</span>
        </span>
      )}
    </div>
  );
}

export function TextInput({
  label, value, onChange, hint, placeholder, maxLength = 80, warn, info, className, autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: ReactNode;
  placeholder?: string;
  maxLength?: number;
  warn?: ReactNode;
  info?: ReactNode;
  className?: string;
  autoFocus?: boolean;
}) {
  const id = useId();
  return (
    <Field label={label} hint={hint} warn={warn} info={info} htmlFor={id} className={className}>
      <input id={id} className="input" type="text" value={value} maxLength={maxLength} placeholder={placeholder} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

export function TextArea({ label, value, onChange, hint, rows = 3, maxLength = 4000, className }: { label: string; value: string; onChange: (v: string) => void; hint?: ReactNode; rows?: number; maxLength?: number; className?: string }) {
  const id = useId();
  return (
    <Field label={label} hint={hint} htmlFor={id} className={className}>
      <textarea id={id} className="input" rows={rows} value={value} maxLength={maxLength} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

/**
 * Number input with −/+ steppers (easy on phones). Keeps a local text draft so
 * typing "-" or "0." works, commits valid numbers immediately, clamps on blur.
 */
export function NumberInput({
  label, value, onChange, min = -9999, max = 9999, step = 1, hint, warn, info, className, decimals = 0, suffix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  hint?: ReactNode;
  warn?: ReactNode;
  info?: ReactNode;
  className?: string;
  decimals?: number;
  suffix?: string;
}) {
  const id = useId();
  const [draft, setDraft] = useState(String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(String(value));
  }, [value]);
  const round = (n: number) => (decimals ? Math.round(n * 10 ** decimals) / 10 ** decimals : Math.round(n));
  const clamp = (n: number) => Math.min(max, Math.max(min, round(n)));
  const commit = (text: string) => {
    const n = Number(text.replace(",", "."));
    if (text.trim() !== "" && Number.isFinite(n)) onChange(clamp(n));
  };
  const bump = (d: number) => {
    const n = clamp((Number.isFinite(value) ? value : 0) + d);
    onChange(n);
    setDraft(String(n));
  };
  return (
    <Field label={label} hint={hint} warn={warn} info={info} htmlFor={id} className={className}>
      <div className="num">
        <button type="button" onClick={() => bump(-step)} aria-label={`Decrease ${label}`} tabIndex={-1}>
          −
        </button>
        <input
          id={id}
          className={`input ${warn ? "warn-border" : ""}`}
          inputMode={decimals || min < 0 ? "decimal" : "numeric"}
          value={draft}
          aria-describedby={suffix ? id + "-suffix" : undefined}
          onFocus={() => (focused.current = true)}
          onChange={(e) => {
            setDraft(e.target.value);
            commit(e.target.value);
          }}
          onBlur={() => {
            focused.current = false;
            const n = Number(draft.replace(",", "."));
            const v = Number.isFinite(n) && draft.trim() !== "" ? clamp(n) : value;
            onChange(v);
            setDraft(String(v));
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp") {
              e.preventDefault();
              bump(step);
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              bump(-step);
            }
          }}
        />
        <button type="button" onClick={() => bump(step)} aria-label={`Increase ${label}`} tabIndex={-1}>
          +
        </button>
      </div>
      {suffix && (
        <span id={id + "-suffix"} className="sr-only">
          {suffix}
        </span>
      )}
    </Field>
  );
}

export interface Opt<T extends string> {
  value: T;
  label: string;
  group?: string;
  disabled?: boolean;
}

export function Select<T extends string>({
  label, value, onChange, options, hint, warn, info, className, placeholder,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: Opt<T>[];
  hint?: ReactNode;
  warn?: ReactNode;
  info?: ReactNode;
  className?: string;
  placeholder?: string;
}) {
  const id = useId();
  const groups = new Map<string, Opt<T>[]>();
  for (const o of options) {
    const g = o.group ?? "";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(o);
  }
  return (
    <Field label={label} hint={hint} warn={warn} info={info} htmlFor={id} className={className}>
      <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value as T)}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {[...groups.entries()].map(([g, opts]) =>
          g ? (
            <optgroup key={g} label={g}>
              {opts.map((o) => (
                <option key={o.value} value={o.value} disabled={o.disabled}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          ) : (
            opts.map((o) => (
              <option key={o.value} value={o.value} disabled={o.disabled}>
                {o.label}
              </option>
            ))
          ),
        )}
      </select>
    </Field>
  );
}

export function Check({ label, checked, onChange, hint }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; hint?: ReactNode }) {
  const showHelp = useSettings((s) => s.showHelp);
  return (
    <div className="field">
      <label className="check">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span>{label}</span>
      </label>
      {hint && showHelp && <span className="hint">{hint}</span>}
    </div>
  );
}

export function Segmented<T extends string>({ label, value, onChange, options, hideLabel }: { label: string; value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; hideLabel?: boolean }) {
  return (
    <div className="field">
      <span className={hideLabel ? "sr-only" : "label"}>{label}</span>
      <div className="seg" role="group" aria-label={label}>
        {options.map((o) => (
          <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

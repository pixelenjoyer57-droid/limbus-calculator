// Game-specific widgets: sin badges, resistance pickers, status pickers.
import { useEffect, useMemo, useState } from "react";
import {
  DMG_LABEL, DMG_TYPES, EGO_GRADE_COLOR, RESIST_PRESETS, SIN_COLOR, SIN_LABEL, SINNERS, SINS, resistTierName,
  type DmgType, type EgoGrade, type Sin,
} from "../engine/constants";
import { BUILTIN_STATUS_LIST, KEYWORD_STATUSES } from "../engine/statuses";
import { useWorkspace } from "../store/workspace";
import { useGameData } from "../gamedata/store";
import { Field, NumberInput, Select, type Opt } from "./controls";

export function SinBadge({ sin }: { sin: Sin | null | undefined }) {
  if (!sin) return <span className="badge">No affinity</span>;
  return (
    <span className="badge" style={{ borderColor: SIN_COLOR[sin], color: SIN_COLOR[sin] }}>
      <span className="sw" style={{ background: SIN_COLOR[sin] }} />
      {SIN_LABEL[sin]}
    </span>
  );
}

export function GradeBadge({ grade }: { grade: EgoGrade }) {
  return (
    <span className="badge" style={{ borderColor: EGO_GRADE_COLOR[grade], color: EGO_GRADE_COLOR[grade] }}>
      {grade}
    </span>
  );
}

export const SIN_OPTIONS: Opt<Sin>[] = SINS.map((s) => ({ value: s, label: SIN_LABEL[s] }));
export const DMG_OPTIONS: Opt<DmgType>[] = DMG_TYPES.map((d) => ({ value: d, label: DMG_LABEL[d] }));
export const SINNER_OPTIONS: Opt<(typeof SINNERS)[number]>[] = SINNERS.map((s) => ({ value: s, label: s }));

/** "G_DIMENSIONAL_RIFT" -> "Dimensional Rift": readable stand-in while game statuses load. */
function nameFromKey(key: string): string {
  const words = key.replace(/^G_+/, "").split("_").filter(Boolean);
  return words.length ? words.map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(" ") : key;
}

/** Name lookup that also knows the workspace's custom statuses and the game's (G_) statuses (loaded on demand). */
export function useStatusName(): (key: string) => string {
  const custom = useWorkspace((s) => s.ws.statuses);
  const game = useGameData((s) => s.statusByKey);
  return useMemo(() => {
    const map = new Map<string, string>(BUILTIN_STATUS_LIST.map((d) => [d.key, d.name]));
    for (const c of custom) map.set(c.key, c.name || "Custom status");
    return (k: string) => {
      const known = map.get(k);
      if (known) return known;
      if (k.startsWith("G_")) {
        const g = game.get(k);
        if (g) return g.name;
        if (!game.size) queueMicrotask(() => void useGameData.getState().ensure("status"));
        return nameFromKey(k);
      }
      return k;
    };
  }, [custom, game]);
}

const GROUP_LABEL: Record<string, string> = {
  keyword: "Keyword statuses",
  power: "Power",
  damage: "Damage dealt",
  defense: "Damage taken",
  speed: "Speed",
  level: "Offense / Defense Level",
  coin: "Coins",
  resist: "Resistance",
  other: "Other",
};

/** Status choices. Game (wiki) statuses are included once loaded; pass `load` to start loading them. */
export function useStatusOptions(load = false): Opt<string>[] {
  const custom = useWorkspace((s) => s.ws.statuses);
  const game = useGameData((s) => s.kinds.status);
  useEffect(() => {
    if (load) void useGameData.getState().ensure("status");
  }, [load]);
  return useMemo(() => {
    const opts: Opt<string>[] = [];
    for (const k of KEYWORD_STATUSES) opts.push({ value: k, label: BUILTIN_STATUS_LIST.find((d) => d.key === k)!.name, group: "Keyword statuses" });
    for (const c of custom) opts.push({ value: c.key, label: c.name || "Custom status", group: "Your custom statuses" });
    for (const d of BUILTIN_STATUS_LIST) {
      if ((KEYWORD_STATUSES as readonly string[]).includes(d.key)) continue;
      opts.push({ value: d.key, label: d.name, group: GROUP_LABEL[d.group] ?? "Other" });
    }
    if (game.status === "ready") {
      const have = new Set(custom.map((c) => c.key));
      const list = game.items.filter((g) => !have.has(g.key)).sort((a, b) => a.name.localeCompare(b.name));
      for (const g of list) opts.push({ value: g.key, label: g.name || nameFromKey(g.key), group: "From the game (wiki)" });
    }
    return opts;
  }, [custom, game]);
}

export function StatusSelect({ label = "Status", value, onChange, className, describedBy }: { label?: string; value: string; onChange: (v: string) => void; className?: string; describedBy?: string }) {
  const [touched, setTouched] = useState(false);
  const isGame = value.startsWith("G_");
  const options = useStatusOptions(touched || isGame);
  const name = useStatusName();
  const shown = isGame && !options.some((o) => o.value === value) ? [{ value, label: name(value), group: "From the game (wiki)" }, ...options] : options;
  return (
    <div onFocusCapture={() => setTouched(true)} onPointerDownCapture={() => setTouched(true)} style={{ display: "contents" }}>
      <Select label={label} value={value} onChange={onChange} options={shown} className={className} describedBy={describedBy} />
    </div>
  );
}

/** Resistance picker: named presets plus a precise number. */
export function ResistField({ label, value, onChange, allowAbove2 }: { label: string; value: number; onChange: (v: number) => void; allowAbove2?: boolean }) {
  const preset = RESIST_PRESETS.find((p) => Math.abs(p.value - value) < 1e-9);
  return (
    <div className="field" style={{ gap: 6 }}>
      <Select
        label={label}
        value={preset ? String(preset.value) : "custom"}
        onChange={(v) => v !== "custom" && onChange(Number(v))}
        options={[...RESIST_PRESETS.map((p) => ({ value: String(p.value), label: p.label })), { value: "custom", label: `Custom ×${value}` }]}
        hint={`${resistTierName(value)}: ${value >= 1 ? `+${Math.round((value - 1) * 100)}%` : `${Math.round(((value - 1) / 2) * 100)}%`} damage taken`}
      />
      {!preset && <NumberInput label={`${label} value`} value={value} onChange={onChange} min={0} max={allowAbove2 ? 10 : 2} step={0.05} decimals={2} />}
    </div>
  );
}

export function SinPicker({ label, value, onChange, allowNone }: { label: string; value: Sin | null; onChange: (v: Sin | null) => void; allowNone?: boolean }) {
  const opts: Opt<string>[] = [...(allowNone ? [{ value: "", label: "No affinity" }] : []), ...SIN_OPTIONS];
  return <Select label={label} value={value ?? ""} onChange={(v) => onChange((v || null) as Sin | null)} options={opts} />;
}

export function MiniField({ children }: { children: React.ReactNode }) {
  return <Field label="">{children}</Field>;
}

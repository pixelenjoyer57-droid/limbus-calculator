// Low-level helpers on battle state: lookups, statuses, logging. No effect
// triggering happens here, which keeps this module free of import cycles.
import { LIMITS, SIN_LABEL, type Sin } from "./constants";
import { BUILTIN_STATUSES, type StatusDef } from "./statuses";
import type { BattleState, LogEntry, Side, StatusInstance, UnitState } from "./types";

export const fmt = (n: number, d = 2) => (Number.isInteger(n) ? String(n) : n.toFixed(d).replace(/0+$/, "").replace(/\.$/, ""));
export const pct = (n: number) => `${n >= 0 ? "+" : ""}${fmt(n * 100, 1)}%`;
export const sinLabel = (s: Sin | null | undefined) => (s ? SIN_LABEL[s] : "No affinity");

export function unit(b: BattleState, uid: string | null | undefined): UnitState | undefined {
  if (!uid) return undefined;
  return b.units.find((u) => u.uid === uid);
}

export function opposite(side: Side): Side {
  return side === "ally" ? "enemy" : "ally";
}

/** Living units on a side that can be targeted (cores and severed parts are excluded). */
export function targetables(b: BattleState, side: Side): UnitState[] {
  return b.units.filter((u) => u.side === side && u.alive && u.targetable);
}

/** Living "bodies" on a side: allies, regular enemies and cores (parts excluded). */
export function bodies(b: BattleState, side: Side): UnitState[] {
  return b.units.filter((u) => u.side === side && u.alive && u.kind !== "part");
}

export function sideUnits(b: BattleState, side: Side): UnitState[] {
  return b.units.filter((u) => u.side === side && u.alive && u.kind !== "core");
}

export function core(b: BattleState, u: UnitState): UnitState {
  return (u.coreUid && unit(b, u.coreUid)) || u;
}

export function canAct(b: BattleState, u: UnitState): boolean {
  if (!u.alive || u.kind === "core") return false;
  const body = core(b, u);
  if (body.stagger > 0 || u.stagger > 0) return false;
  if (u.panic === "panic") return false;
  if (statusValue(b, u, "IMMOBILIZED") > 0) return false;
  if (u.breakable === "severable" && u.broken) return false;
  return true;
}

export function staggerLevel(b: BattleState, u: UnitState): number {
  return Math.max(u.stagger, core(b, u).stagger);
}

// ---- logging ---------------------------------------------------------------------
export function detailed(b: BattleState): boolean {
  return b.settings.logDetail === "full";
}

export function log(b: BattleState, kind: LogEntry["kind"], text: string, details?: string[], extra?: Partial<LogEntry>) {
  if (b.settings.logDetail === "none" && kind !== "result") return;
  b.log.push({ turn: b.turn, kind, text, details: detailed(b) ? details : undefined, ...extra });
  if (b.log.length > 6000) b.log.splice(0, b.log.length - 6000);
}

export function stat(b: BattleState, u: UnitState) {
  const key = u.kind === "part" && u.coreUid ? u.coreUid : u.uid;
  let s = b.stats[key];
  if (!s) {
    s = b.stats[key] = {
      name: u.kind === "part" && u.coreUid ? unit(b, u.coreUid)?.name ?? u.name : u.name,
      side: u.side,
      damageDealt: 0,
      damageTaken: 0,
      statusDamageDealt: 0,
      clashesWon: 0,
      clashesLost: 0,
      kills: 0,
      hpEnd: u.hp,
      maxHp: u.maxHp,
      alive: true,
    };
  }
  return s;
}

// ---- statuses --------------------------------------------------------------------
export function statusDef(b: BattleState, key: string): StatusDef | undefined {
  return BUILTIN_STATUSES[key] ?? b.content.statuses[key];
}

export function statusName(b: BattleState, key: string): string {
  return statusDef(b, key)?.name ?? key;
}

export function getStatus(u: UnitState, key: string): StatusInstance | undefined {
  return u.statuses.find((s) => s.key === key);
}

/** Value of a status: potency for potency/count statuses, otherwise the single value. */
export function statusValue(b: BattleState, u: UnitState, key: string, field: "potency" | "count" = "potency"): number {
  const s = getStatus(u, key);
  if (!s) return 0;
  const def = statusDef(b, key);
  if (def?.mode === "value") return s.count;
  return field === "potency" ? s.potency : s.count;
}

/** Like statusValue, but also counts "Unique" variants (custom statuses that count as `key`). */
export function statusTotal(b: BattleState, u: UnitState, key: string, field: "potency" | "count"): number {
  let total = 0;
  for (const s of u.statuses) {
    if (s.key === key || statusDef(b, s.key)?.countsAs === key) {
      const def = statusDef(b, s.key);
      total += def?.mode === "value" ? s.count : field === "potency" ? s.potency : s.count;
    }
  }
  return total;
}

export function hasStatus(b: BattleState, u: UnitState, key: string): boolean {
  return u.statuses.some((s) => (s.key === key || statusDef(b, s.key)?.countsAs === key) && (s.potency > 0 || s.count > 0));
}

export interface AddResult {
  key: string;
  potency: number;
  count: number;
  timing: "now" | "nextTurn";
}

/**
 * Inflict / gain a status. Follows the game convention: inflicting Potency on a unit
 * without the status gives it the base Count (1), and vice versa.
 */
export function addStatus(
  b: BattleState,
  u: UnitState,
  key: string,
  potency: number,
  count: number,
  timing: "now" | "nextTurn" = "now",
): AddResult | null {
  const def = statusDef(b, key);
  if (!def || !u.alive) return null;
  potency = Math.max(0, Math.floor(potency));
  count = Math.max(0, Math.floor(count));
  if (potency <= 0 && count <= 0) return null;
  if (timing === "nextTurn") {
    // stored raw; base values are applied when it lands at the next Turn Start
    const p = u.pending.find((x) => x.key === key);
    if (p) {
      p.potency += potency;
      p.count += count;
    } else u.pending.push({ key, potency, count });
    return { key, potency, count, timing };
  }
  const list = u.statuses;
  let s = list.find((x) => x.key === key);
  if (def.mode === "value") {
    const amount = count > 0 ? count : potency;
    if (s) s.count = Math.min(def.maxCount, s.count + amount);
    else list.push((s = { key, potency: 0, count: Math.min(def.maxCount, amount) }));
    return { key, potency: 0, count: amount, timing };
  }
  if (s) {
    s.potency = Math.min(def.maxPotency, s.potency + potency);
    s.count = Math.min(def.maxCount, s.count + count);
  } else {
    s = { key, potency: Math.min(def.maxPotency, potency > 0 ? potency : 1), count: Math.min(def.maxCount, count > 0 ? count : 1) };
    list.push(s);
  }
  return { key, potency, count, timing };
}

/** Reduce a status value. Returns how much was actually removed. */
export function reduceStatus(b: BattleState, u: UnitState, key: string, field: "potency" | "count", amount: number): number {
  const s = getStatus(u, key);
  if (!s || amount <= 0) return 0;
  const def = statusDef(b, key);
  const f = def?.mode === "value" ? "count" : field;
  const before = s[f];
  s[f] = Math.max(0, s[f] - Math.floor(amount));
  cleanupStatus(b, u, s);
  return before - Math.max(0, s[f]);
}

export function removeStatus(u: UnitState, key: string) {
  u.statuses = u.statuses.filter((s) => s.key !== key);
}

export function cleanupStatus(b: BattleState, u: UnitState, s: StatusInstance) {
  const def = statusDef(b, s.key);
  if (!def) return;
  if (def.mode === "value") {
    if (s.count <= 0) removeStatus(u, s.key);
    return;
  }
  // Charge with 2+ Potency persists at 0 Count.
  if (s.key === "CHARGE" && s.potency >= 2) {
    s.count = Math.max(0, s.count);
    return;
  }
  if (s.potency <= 0 || s.count <= 0) removeStatus(u, s.key);
}

export function negativeCount(b: BattleState, u: UnitState): number {
  return u.statuses.filter((s) => statusDef(b, s.key)?.polarity === "negative").length;
}
export function positiveCount(b: BattleState, u: UnitState): number {
  return u.statuses.filter((s) => statusDef(b, s.key)?.polarity === "positive").length;
}

export function describeStatuses(b: BattleState, u: UnitState): string {
  if (!u.statuses.length) return "no statuses";
  return u.statuses
    .map((s) => {
      const def = statusDef(b, s.key);
      if (def?.mode === "value") return `${def?.name ?? s.key} ${s.count}`;
      return `${def?.name ?? s.key} ${s.potency}/${s.count}`;
    })
    .join(", ");
}

export function clampSp(sp: number): number {
  return Math.max(LIMITS.sp.min, Math.min(LIMITS.sp.max, sp));
}

export function newActionId(b: BattleState): string {
  b.nextId += 1;
  return "a" + b.nextId;
}

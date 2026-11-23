// Combat resolution: Clashes, attacks, defense skills, damage, Stagger and death.
// Rules follow the Limbus Company wiki (Battles, Skills, Damage Formula pages).
import { DMG_LABEL, LIMITS, SIN_LABEL, resistTierName, type DmgType, type Sin } from "./constants";
import {
  clampResist, clashCountMod, clashWinSp, critModifier, finalDamage, guardReducedRoll, headsChance,
  levelAdvantage, levelClashBonus, physResistMod, poiseCritChance, resistMod, allyDeathSp,
} from "./formulas";
import * as R from "./rng";
import {
  canAct, clampSp, core, detailed, fmt, getStatus, log, opposite, pct, reduceStatus,
  removeStatus, sideUnits, stat, statusValue, staggerLevel, targetables, unit,
} from "./state";
import type { BattleState, CSkill, PlannedAction, UnitState } from "./types";
import type { Coin } from "../data/schema";
import {
  checkCondition, collectMods, evalValue, fireSkill, fireUnit, sumParts, unitSources,
  type CoinRun, type CoinState, type Ctx, type ModPart, type SkillUse,
} from "./effects";
import { TREMOR_TYPE_INFO } from "./statuses";

export interface HitRecord {
  turn: number;
  attacker: string;
  target: string;
  skill: string;
  coin: number;
  heads: boolean;
  crit: boolean;
  roll: number;
  rollBeforeGuard: number;
  offLevel: number;
  defLevel: number;
  staticParts: ModPart[];
  dynamicParts: ModPart[];
  raw: number;
  final: number;
  floorApplied: string;
  extra: ModPart[]; // follow-up damage on the same hit (Rupture, adders ...)
  evaded?: boolean;
}

declare module "./types" {
  interface BattleState {
    hits?: HitRecord[];
    metrics?: { clashRounds: number; clashes: number };
  }
}

// ---------------------------------------------------------------------------------
// Readied defense skills (Guard / Evade / Counter, clashable variants)
// ---------------------------------------------------------------------------------
export interface Readied {
  actionId: string;
  uid: string;
  skill: CSkill;
  used: boolean;
  failed: boolean; // evade failed this turn
}

const readied = new WeakMap<BattleState, Readied[]>();
export function setReadied(b: BattleState, list: Readied[]) {
  readied.set(b, list);
}
export function readiedFor(b: BattleState, u: UnitState): Readied[] {
  return (readied.get(b) ?? []).filter((r) => r.uid === u.uid && !r.used && !r.failed);
}

// ---------------------------------------------------------------------------------
// Levels and resistances
// ---------------------------------------------------------------------------------
function ctxOf(b: BattleState, use: SkillUse, other?: UnitState, coin?: CoinRun): Ctx {
  return { b, self: use.user, other: other ?? use.mainTarget, mainTarget: use.mainTarget, use, skill: use.skill, coin };
}

export function offenseLevel(b: BattleState, use: SkillUse, other?: UnitState, coin?: CoinRun): { value: number; parts: ModPart[] } {
  const u = use.user;
  const ctx = ctxOf(b, use, other, coin);
  const parts: ModPart[] = [{ label: `Level ${u.level}`, value: u.level }];
  if (use.skill.levelMod) parts.push({ label: "Skill modifier", value: use.skill.levelMod });
  if (use.resonance) parts.push({ label: "Sin Resonance", value: use.resonance });
  const up = statusValue(b, u, "OFFENSE_LEVEL_UP");
  const down = statusValue(b, u, "OFFENSE_LEVEL_DOWN");
  if (up) parts.push({ label: "Offense Level Up", value: up });
  if (down) parts.push({ label: "Offense Level Down", value: -down });
  parts.push(...collectMods("offenseLevel", ctx));
  return { value: Math.max(1, sumParts(parts)), parts };
}

/** Defense Level of `u`. When `defUse` is a defense skill being used, its own Defense Level applies. */
export function defenseLevel(b: BattleState, u: UnitState, attackerUse?: SkillUse, defUse?: SkillUse): { value: number; parts: ModPart[] } {
  const body = u.kind === "part" ? u : core(b, u);
  const parts: ModPart[] = [{ label: `Level ${body.level}`, value: body.level }];
  if (defUse) {
    if (defUse.skill.levelMod) parts.push({ label: `${defUse.skill.name} modifier`, value: defUse.skill.levelMod });
    if (defUse.resonance) parts.push({ label: "Sin Resonance", value: defUse.resonance });
  } else if (body.defenseMod) parts.push({ label: "Defense modifier", value: body.defenseMod });
  const up = statusValue(b, u, "DEFENSE_LEVEL_UP");
  const down = statusValue(b, u, "DEFENSE_LEVEL_DOWN");
  if (up) parts.push({ label: "Defense Level Up", value: up });
  if (down) parts.push({ label: "Defense Level Down", value: -down });
  const tremor = getStatus(u, "TREMOR");
  if (tremor?.tremorTypes?.includes("DECAY")) {
    const n = Math.floor(tremor.potency / 4);
    if (n) parts.push({ label: "Tremor - Decay", value: -n });
  }
  const ctx: Ctx = { b, self: u, other: attackerUse?.user, use: defUse ?? attackerUse, skill: attackerUse?.skill };
  parts.push(...collectMods("defenseLevel", ctx));
  return { value: Math.max(1, sumParts(parts)), parts };
}

/** Resistance value after Resist Down statuses and resist modifiers, clamped to [0, 2]. */
export function resistValue(b: BattleState, u: UnitState, kind: "phys" | "sin", key: string, ctx?: Ctx): number {
  const body = u.kind === "part" ? u : core(b, u);
  let x = kind === "phys" ? body.resist[key as DmgType] : body.sinResist[key as Sin];
  x += 0.1 * statusValue(b, u, `${key}_RESIST_DOWN`);
  for (const m of u.mods) if (m.stat === "resist" && (m.sin === key || m.dmgType === key)) x += m.value;
  // "always" passive / status / gift modifiers such as "Wrath Resistance +0.5"
  const c: Ctx = ctx ? { ...ctx, self: u } : { b, self: u };
  for (const src of unitSources(b, u, true)) {
    if (src.effect.trigger !== "always") continue;
    const acts = src.effect.actions.filter((a) => a.kind === "mod" && a.stat === "resist" && (a.sin === key || a.dmgType === key));
    if (!acts.length) continue;
    if (!src.effect.conditions.every((cond) => cond.kind === "chance" || checkCondition(cond, c))) continue;
    for (const a of acts) x += evalValue(a.amount, c);
  }
  return clampResist(x);
}

export function typedResistFactor(b: BattleState, u: UnitState, sin: Sin | null, dmgType: DmgType | null): number {
  let f = 1;
  if (sin) f += resistMod(resistValue(b, u, "sin", sin));
  if (dmgType) {
    const st = staggerLevel(b, u);
    f += physResistMod(u.broken && u.breakable === "destructible" ? 2 : resistValue(b, u, "phys", dmgType), st);
  }
  return Math.max(0, f);
}

// ---------------------------------------------------------------------------------
// Power
// ---------------------------------------------------------------------------------
export function basePower(b: BattleState, use: SkillUse, coin?: CoinRun): { value: number; parts: ModPart[] } {
  const parts: ModPart[] = [{ label: "Base Power", value: use.skill.basePower }];
  const bpu = statusValue(b, use.user, "BASE_POWER_UP");
  if (bpu) parts.push({ label: "Base Power Up", value: bpu });
  parts.push(...collectMods("basePower", ctxOf(b, use, undefined, coin)));
  return { value: sumParts(parts), parts };
}

/** Turn a saved coin into its runtime state, applying its custom coin type (if any). */
export function resolveCoin(b: BattleState, c: Coin, index: number): CoinState {
  const t = c.customType ? b.content.coinTypes?.[c.customType] : undefined;
  return {
    kind: t ? t.clash : c.kind,
    effects: c.effects,
    typeEffects: t?.effects ?? [],
    index,
    destroyed: false,
    cracked: false,
    power: c.power ?? t?.power ?? null,
    op: c.op ?? t?.op ?? "add",
    mult: c.mult ?? t?.mult ?? 2,
    dmgType: c.dmgType ?? t?.dmgType ?? null,
    sin: c.sin ?? t?.sin ?? null,
    headsBonus: c.headsBonus + (t?.headsBonus ?? 0),
    fixed: c.fixed ?? (t && t.fixed !== "none" ? t.fixed : null),
    ignoreParalyze: !!t?.ignoreParalyze,
    crackedPower: t?.crackedPower ?? 1,
    typeName: t?.name,
  };
}

export interface CoinValue {
  op: "add" | "multiply";
  value: number;
}

/**
 * What one coin adds on Heads (its Coin Power, after Coin Boost/Drop and modifiers),
 * or what it multiplies the power by for multiply coins. Cracked coins use their
 * cracked power (1 in the game) before modifiers.
 */
export function coinValue(b: BattleState, use: SkillUse, c: CoinState, coin?: CoinRun): CoinValue {
  if (c.op === "multiply") return { op: "multiply", value: c.cracked ? 1 : Math.max(0, c.mult) };
  const own = c.power ?? use.skill.coinPower;
  const plus = own >= 0;
  let cp = c.cracked ? (plus ? c.crackedPower : -c.crackedPower) : own;
  const ctx = ctxOf(b, use, undefined, coin ?? { index: c.index, coin: c, heads: false, crit: false, mods: [], damage: 0, reuse: 0, isReuse: false });
  for (const m of use.mods) if (m.stat === "coinPower" && (!m.coin || m.coin === c.index)) cp += m.value;
  for (const p of collectMods("coinPower", ctx)) cp += p.value;
  if (plus) {
    cp += statusValue(b, use.user, "PLUS_COIN_BOOST");
    cp = Math.max(0, cp - statusValue(b, use.user, "PLUS_COIN_DROP"));
  } else {
    cp -= statusValue(b, use.user, "MINUS_COIN_BOOST");
    cp = Math.min(0, cp + statusValue(b, use.user, "MINUS_COIN_DROP"));
  }
  return { op: "add", value: cp };
}

/** Coin Power of one add-coin (kept for callers that only need the number). */
export function coinPower(b: BattleState, use: SkillUse, c: CoinState, coin?: CoinRun): number {
  const v = coinValue(b, use, c, coin);
  return v.op === "add" ? v.value : 0;
}

/** Final Power bonuses from Power Up style statuses and modifiers. */
export function finalPowerMods(b: BattleState, use: SkillUse, coin?: CoinRun): ModPart[] {
  const u = use.user;
  const s = use.skill;
  const parts: ModPart[] = [];
  const add = (key: string, label: string, sign = 1) => {
    const v = statusValue(b, u, key);
    if (v) parts.push({ label, value: sign * v });
  };
  add("POWER_UP", "Power Up");
  add("POWER_DOWN", "Power Down", -1);
  if (s.kind === "attack" || s.kind === "counter") {
    add("ATTACK_POWER_UP", "Attack Power Up");
    add("ATTACK_POWER_DOWN", "Attack Power Down", -1);
    add(`${s.dmgType}_POWER_UP`, `${DMG_LABEL[s.dmgType]} Power Up`);
    add(`${s.dmgType}_POWER_DOWN`, `${DMG_LABEL[s.dmgType]} Power Down`, -1);
  } else {
    add("DEFENSE_POWER_UP", "Defense Power Up");
    add("DEFENSE_POWER_DOWN", "Defense Power Down", -1);
  }
  if (s.sin) {
    add(`${s.sin}_POWER_UP`, `${SIN_LABEL[s.sin]} Power Up`);
    add(`${s.sin}_POWER_DOWN`, `${SIN_LABEL[s.sin]} Power Down`, -1);
  }
  parts.push(...collectMods("finalPower", ctxOf(b, use, undefined, coin)));
  return parts;
}

function clashPowerMods(b: BattleState, use: SkillUse, opp: SkillUse, oppDefLevel: number | null): ModPart[] {
  const u = use.user;
  const parts: ModPart[] = [];
  const up = statusValue(b, u, "CLASH_POWER_UP");
  const down = statusValue(b, u, "CLASH_POWER_DOWN");
  if (up) parts.push({ label: "Clash Power Up", value: up });
  if (down) parts.push({ label: "Clash Power Down", value: -down });
  const tremor = getStatus(u, "TREMOR");
  if (tremor?.tremorTypes?.includes("CHAIN")) {
    const n = Math.min(3, Math.floor(tremor.potency / 10));
    if (n) parts.push({ label: "Tremor - Chain", value: -n });
  }
  // Level difference: +1 per 3 levels for the higher side.
  const my = levelForClash(b, use, opp);
  const their = oppDefLevel ?? levelForClash(b, opp, use);
  const bonus = levelClashBonus(my, their);
  if (bonus) parts.push({ label: `Level ${my} vs ${their}`, value: bonus });
  parts.push(...collectMods("clashPower", ctxOf(b, use, opp.user)));
  return parts;
}

function levelForClash(b: BattleState, use: SkillUse, opp: SkillUse): number {
  if (use.skill.kind === "attack" || use.skill.kind === "counter") return offenseLevel(b, use, opp.user).value;
  return defenseLevel(b, use.user, opp, use).value;
}

function headsP(b: BattleState, use: SkillUse): number {
  const bonus = sumParts(collectMods("headsChance", ctxOf(b, use)));
  return headsChance(use.user.sp, use.user.hasSanity, bonus);
}

export interface Tossed extends CoinValue {
  heads: boolean;
  paralyzed: boolean;
}

/**
 * Toss one coin. Coins fixed to Heads/Tails ignore luck (and forced test outcomes);
 * other coins use 50 + SP plus their own Heads bonus. Paralyze fixes the coin's power to 0
 * (a multiply coin then multiplies by 1) and is used up one Count per coin.
 */
function tossCoin(b: BattleState, use: SkillUse, c: CoinState, coin?: CoinRun): Tossed {
  let heads: boolean;
  if (c.fixed === "heads") heads = true;
  else if (c.fixed === "tails") heads = false;
  else {
    const f = b.settings.forceCoins?.[use.user.side];
    if (f === "heads") heads = true;
    else if (f === "tails") heads = false;
    else heads = R.chance(b.rng, Math.max(0, Math.min(1, headsP(b, use) + c.headsBonus / 100)));
  }
  let paralyzed = false;
  if (!c.ignoreParalyze && statusValue(b, use.user, "PARALYZE") > 0) {
    paralyzed = true;
    reduceStatus(b, use.user, "PARALYZE", "count", 1);
  }
  const cv = coinValue(b, use, c, coin);
  const live = heads && !paralyzed;
  return { heads, paralyzed, op: cv.op, value: live ? cv.value : cv.op === "multiply" ? 1 : 0 };
}

/** Power so far: (Base + every Heads add-coin) × every Heads multiply-coin, rounded down. */
interface PowerAcc {
  add: number;
  mul: number;
}
const newAcc = (): PowerAcc => ({ add: 0, mul: 1 });
function accPush(a: PowerAcc, t: Tossed) {
  if (t.op === "multiply") a.mul *= t.value;
  else a.add += t.value;
}
function accTotal(a: PowerAcc, base: number): number {
  return Math.floor((base + a.add) * a.mul + 1e-9);
}

// ---------------------------------------------------------------------------------
// HP, SP, Shield, Stagger, death
// ---------------------------------------------------------------------------------
export interface DamageOpts {
  label: string;
  by?: UnitState;
  canStagger: boolean;
  sin?: Sin | null;
  dmgType?: DmgType | null;
  adder?: boolean;
  status?: string; // status damage (Burn, Bleed ...)
}

/** Deal damage to `t` (Shield first). Handles parts/core and records stats. */
export function applyDamage(b: BattleState, t: UnitState, amount: number, opts: DamageOpts): number {
  if (!t.alive || amount <= 0) return 0;
  const body = core(b, t);
  let rest = Math.floor(amount);
  if (body.shield > 0) {
    const absorbed = Math.min(body.shield, rest);
    body.shield -= absorbed;
    rest -= absorbed;
  }
  if (rest > 0) {
    if (t.kind === "part") {
      t.hp = Math.max(0, t.hp - rest);
      if (t.hp <= 0 && !t.broken) breakPart(b, t);
    }
    body.hp -= rest;
    body.turn.hpLost += rest;
  }
  const dealt = Math.floor(amount);
  const ts = stat(b, t);
  ts.damageTaken += dealt;
  if (opts.by) {
    const bs = stat(b, opts.by);
    bs.damageDealt += dealt;
    if (opts.status) bs.statusDamageDealt += dealt;
    opts.by.turn.damageDealt += dealt;
  }
  if (opts.canStagger && body.shield <= 0) checkStagger(b, t, false);
  if (body.hp <= 0) killUnit(b, body, opts.by);
  return dealt;
}

function breakPart(b: BattleState, p: UnitState) {
  p.broken = true;
  if (p.breakable === "severable") {
    p.targetable = false;
    log(b, "info", `${p.name} is severed and can no longer be targeted or act.`);
  } else if (p.breakable === "destructible") {
    log(b, "info", `${p.name} is destroyed: its physical Resistances become Fatal ×2.`);
  } else {
    p.broken = false;
    log(b, "info", `${p.name} reaches 0 HP but is indestructible (recovers next turn).`);
  }
}

/** Fixed damage (statuses, "deal X damage" effects). Ignores everything except an optional typed resistance. */
export function dealFixedDamage(b: BattleState, t: UnitState, n: number, opts: DamageOpts): number {
  if (!t.alive || n <= 0) return 0;
  let dmg = n;
  if (opts.sin || opts.dmgType) dmg = Math.floor(n * typedResistFactor(b, t, opts.sin ?? null, opts.dmgType ?? null) + 1e-9);
  const statusMod = opts.status ? sumParts(collectMods("statusDmgTaken", { b, self: t, other: opts.by }, opts.status)) / 100 : 0;
  if (statusMod) dmg = Math.max(0, Math.floor(dmg * (1 + statusMod) + 1e-9));
  if (dmg <= 0) return 0;
  const typed = opts.sin ? ` ${SIN_LABEL[opts.sin]}` : opts.dmgType ? ` ${DMG_LABEL[opts.dmgType]}` : " fixed";
  const dealt = applyDamage(b, t, dmg, opts);
  log(b, "damage", `${t.name} takes ${dealt}${typed} damage (${opts.label})`, undefined, { side: t.side });
  return dealt;
}

export function healHp(b: BattleState, t: UnitState, n: number, label: string) {
  const body = core(b, t);
  if (!body.alive || n <= 0) return;
  const before = body.hp;
  body.hp = Math.min(body.maxHp, body.hp + n);
  if (t.kind === "part") t.hp = Math.min(t.maxHp, t.hp + n);
  if (body.hp > before) log(b, "effect", `${t.name} heals ${body.hp - before} HP (${label})`);
}

export function changeSp(b: BattleState, t: UnitState, delta: number, label: string) {
  if (!t.hasSanity || !t.alive || !delta) return;
  if (t.side === "ally" && t.panic === "panic" && t.sp <= LIMITS.sp.min) return; // fixed at -45 until Turn Start
  const before = t.sp;
  t.sp = clampSp(t.sp + delta);
  if (t.sp < before) t.turn.spLost += before - t.sp;
  if (t.sp !== before) log(b, "sp", `${t.name} ${t.sp > before ? "gains" : "loses"} ${Math.abs(t.sp - before)} SP → ${t.sp} (${label})`, undefined, { side: t.side });
}

/** Stagger when HP falls to/below an untriggered threshold (or the threshold rises above HP). */
export function checkStagger(b: BattleState, t: UnitState, viaThreshold: boolean) {
  const body = core(b, t);
  if (!body.alive) return;
  if (sumParts(collectMods("cannotBeStaggered", { b, self: body })) > 0) return;
  const passed = body.thresholds.filter((x) => !x.triggered && body.hp <= x.hp);
  if (!passed.length) return;
  for (const p of passed) p.triggered = true;
  const already = body.stagger > 0;
  if (!already) {
    body.stagger = Math.min(3, passed.length);
    body.staggerTurn = b.turn;
  } else if (body.staggerTurn === b.turn) {
    body.stagger = Math.min(3, body.stagger + passed.length);
  } else return;
  const tremor = getStatus(t, "TREMOR");
  if (tremor?.tremorTypes?.includes("FRACTURE") && tremor.potency + tremor.count >= 20 && body.stagger < 3) body.stagger += 1;
  for (const part of b.units) if (part.coreUid === body.uid) {
    part.stagger = body.stagger;
    part.staggerTurn = body.staggerTurn;
  }
  const name = ["", "Staggered", "Staggered+", "Staggered++"][body.stagger];
  log(b, "stagger", `${body.name} is ${name}!${viaThreshold ? " (threshold raised above HP)" : ""}`, undefined, { side: body.side, important: true });
  cancelActions(b, body);
  fireUnit("whenStaggered", { b, self: body });
  for (const e of sideUnits(b, opposite(body.side))) fireUnit("onEnemyStaggered", { b, self: e, other: body });
}

export function forceStagger(b: BattleState, t: UnitState, label: string) {
  const body = core(b, t);
  if (!body.alive) return;
  if (body.stagger === 0) {
    body.stagger = 1;
    body.staggerTurn = b.turn;
    log(b, "stagger", `${body.name} is Staggered! (${label})`, undefined, { important: true });
    cancelActions(b, body);
    fireUnit("whenStaggered", { b, self: body });
  }
}

/** Raise the highest untriggered Stagger Threshold by `n` HP (Tremor Burst, Clashable Guard win). */
export function raiseThreshold(b: BattleState, t: UnitState, n: number, label: string) {
  const body = core(b, t);
  if (!body.alive || n <= 0) return;
  const next = body.thresholds.filter((x) => !x.triggered).sort((a, c) => c.hp - a.hp)[0];
  if (!next) {
    log(b, "info", `${body.name} has no Stagger Threshold left to raise (${label}).`);
    return;
  }
  next.hp += n;
  log(b, "stagger", `${body.name}'s Stagger Threshold rises by ${n} → ${next.hp} HP (${label})`);
  if (body.shield <= 0) checkStagger(b, body, true);
}

export function tremorBurst(b: BattleState, t: UnitState, by: UnitState, label: string, extra = false) {
  const s = getStatus(t, "TREMOR");
  if (!s || !t.alive) return;
  const types = s.tremorTypes ?? [];
  log(b, "status", `Tremor Burst on ${t.name} (${label})${extra ? " [extra]" : ""}`);
  raiseThreshold(b, t, s.potency, "Tremor Burst");
  if (types.includes("REVERB")) dealFixedDamage(b, t, s.potency, { label: TREMOR_TYPE_INFO.REVERB.name, by, canStagger: true, sin: "SLOTH", status: "TREMOR" });
  if (types.includes("SCORCH")) {
    const burn = getStatus(t, "BURN");
    dealFixedDamage(b, t, Math.floor((s.potency + (burn?.potency ?? 0)) / 2), { label: TREMOR_TYPE_INFO.SCORCH.name, by, canStagger: true, sin: "WRATH", status: "TREMOR" });
    if (burn) reduceStatus(b, t, "BURN", "count", 1);
  }
  if (types.includes("HEMORRHAGE")) {
    const bleed = getStatus(t, "BLEED");
    dealFixedDamage(b, t, Math.floor((s.potency + (bleed?.potency ?? 0)) / 2), { label: TREMOR_TYPE_INFO.HEMORRHAGE.name, by, canStagger: true, sin: "LUST", status: "TREMOR" });
    if (bleed) reduceStatus(b, t, "BLEED", "count", 1);
  }
  if (!extra) {
    if (types.includes("EVERLASTING")) {
      const p1 = Math.min(0.5, s.potency / 100);
      const p2 = Math.min(0.5, s.count / 100);
      if (R.chance(b.rng, p1)) tremorBurst(b, t, by, label, true);
      if (R.chance(b.rng, p2)) tremorBurst(b, t, by, label, true);
    }
    reduceStatus(b, t, "TREMOR", "count", 1);
  }
}

export function sinkingDeluge(b: BattleState, t: UnitState, by: UnitState, label: string) {
  const s = getStatus(t, "SINKING");
  if (!s || !t.alive) return;
  const total = s.potency * s.count;
  removeStatus(t, "SINKING");
  if (t.hasSanity) {
    const room = t.sp - LIMITS.sp.min;
    changeSp(b, t, -total, `Sinking Deluge (${label})`);
    const excess = total - room;
    if (excess > 0) dealFixedDamage(b, t, excess, { label: "Sinking Deluge overflow", by, canStagger: true, sin: "GLOOM", status: "SINKING" });
  } else dealFixedDamage(b, t, total, { label: "Sinking Deluge", by, canStagger: true, sin: "GLOOM", status: "SINKING" });
}

function cancelActions(b: BattleState, u: UnitState) {
  const uids = new Set([u.uid, ...b.units.filter((p) => p.coreUid === u.uid).map((p) => p.uid)]);
  for (const a of b.plan) if (uids.has(a.uid) && !a.done) {
    a.done = true;
    a.note = "Cancelled (Staggered)";
  }
}

export function killUnit(b: BattleState, u: UnitState, by?: UnitState) {
  if (!u.alive) return;
  u.alive = false;
  u.hp = Math.min(u.hp, 0);
  u.deathTurn = b.turn;
  for (const p of b.units) if (p.coreUid === u.uid) p.alive = false;
  for (const a of b.plan) if ((a.uid === u.uid || unit(b, a.uid)?.coreUid === u.uid) && !a.done) a.done = true;
  stat(b, u).alive = false;
  log(b, "death", `${u.name} is defeated${by ? ` by ${by.name}` : ""}.`, undefined, { side: u.side, important: true });
  if (by) {
    stat(b, by).kills += 1;
    if (by.side !== u.side) {
      // SP base factors: killer +10, other allies +5 when the victim's level >= theirs
      for (const ally of sideUnits(b, by.side)) {
        if (!ally.hasSanity) continue;
        if (u.level < ally.level) continue;
        changeSp(b, ally, ally.uid === by.uid ? 10 : 5, ally.uid === by.uid ? "defeated an enemy" : "ally defeated an enemy");
      }
      fireUnit("onKillAny", { b, self: by, other: u });
    }
  }
  for (const ally of sideUnits(b, u.side)) {
    if (ally.uid === u.uid) continue;
    const loss = allyDeathSp(u.level, ally.level);
    if (loss && ally.hasSanity) changeSp(b, ally, -loss, `${u.name} died`);
    fireUnit("onAllyDeath", { b, self: ally, other: u });
  }
}

// ---------------------------------------------------------------------------------
// Skill use lifecycle
// ---------------------------------------------------------------------------------
export function newUse(b: BattleState, action: PlannedAction, user: UnitState, skill: CSkill, target: UnitState): SkillUse {
  return {
    actionId: action.id,
    user,
    skill,
    mainTarget: target,
    targets: [target],
    coins: skill.coins.map((c, i) => resolveCoin(b, c, i + 1)),
    mods: [],
    clashCount: 0,
    clashed: false,
    result: null,
    heads: 0,
    tails: 0,
    damage: 0,
    resonance: action.resonance ?? 0,
    isEgo: skill.slot === "EGO",
    defending: skill.kind !== "attack",
    guardPower: 0,
    cancelled: false,
    lastPower: 0,
    lastClashPower: 0,
  };
}

/** [On Use]: pay E.G.O costs, gain an E.G.O resource, fire On Use effects. */
export function onUse(b: BattleState, use: SkillUse) {
  const u = use.user;
  const s = use.skill;
  if (s.kind === "attack" && !use.isEgo && s.sin && u.side === "ally") b.resources[u.side][s.sin] += 1;
  fireSkill("onUse", { b, self: u, other: use.mainTarget, mainTarget: use.mainTarget, use, skill: s });
  fireUnit("onSkillUse", { b, self: u, other: use.mainTarget, use, skill: s });
}

function activeCoins(use: SkillUse) {
  return use.coins.filter((c) => !c.destroyed && !c.cracked);
}

function bleedOnToss(b: BattleState, u: UnitState, skill: CSkill) {
  if (skill.kind !== "attack") return; // Defense skills (incl. Counters) never trigger Bleed
  const s = getStatus(u, "BLEED");
  if (!s || !u.alive) return;
  const n = s.potency;
  reduceStatus(b, u, "BLEED", "count", 1);
  dealFixedDamage(b, u, n, { label: "Bleed", canStagger: false, status: "BLEED", by: undefined });
}

interface ClashSideRoll {
  power: number;
  heads: number;
  coins: number;
  detail: string;
}

function rollClash(b: BattleState, use: SkillUse, opp: SkillUse, oppDefLevel: number | null): ClashSideRoll {
  // remembered for Clashable Guards (threshold raise on win, roll reduction on loss)
  const base = basePower(b, use);
  let heads = 0;
  const acc = newAcc();
  const marks: string[] = [];
  for (const c of activeCoins(use)) {
    const r = tossCoin(b, use, c);
    if (r.heads) heads++;
    accPush(acc, r);
    marks.push(r.paralyzed ? "P" : r.heads ? "H" : "T");
  }
  const fp = sumParts(finalPowerMods(b, use));
  const sum = accTotal(acc, base.value);
  const power = Math.max(0, sum + fp);
  const cpm = clashPowerMods(b, use, opp, oppDefLevel);
  const clashPower = Math.max(0, power + sumParts(cpm));
  use.lastPower = power;
  use.lastClashPower = clashPower;
  const detail = detailed(b)
    ? `${use.user.name}: ${marks.join("")} → ${base.value}${acc.add ? ` + ${acc.add}` : ""}${acc.mul !== 1 ? ` ×${fmt(acc.mul)}` : ""}${fp ? ` ${fp > 0 ? "+" : "−"} ${Math.abs(fp)} power` : ""}${cpm.length ? ` + clash (${cpm.map((p) => `${p.label} ${p.value > 0 ? "+" : ""}${p.value}`).join(", ")})` : ""} = ${clashPower}`
    : "";
  return { power: clashPower, heads, coins: marks.length, detail };
}

/**
 * Resolve a Clash between two skill uses. Returns the winner (or null when both are
 * cancelled at 99 Clash count).
 */
export function resolveClash(b: BattleState, A: SkillUse, B: SkillUse): SkillUse | null {
  A.clashed = B.clashed = true;
  A.mainTarget = B.user;
  B.mainTarget = A.user;
  onUse(b, A);
  onUse(b, B);
  fireSkill("clashStart", { b, self: A.user, other: B.user, use: A, skill: A.skill });
  fireSkill("clashStart", { b, self: B.user, other: A.user, use: B, skill: B.skill });
  const aDef = A.skill.kind === "guard" ? defenseLevel(b, A.user, B, A).value : null;
  const bDef = B.skill.kind === "guard" ? defenseLevel(b, B.user, A, B).value : null;
  const rounds: string[] = [];
  let count = 0;
  while (activeCoins(A).length && activeCoins(B).length) {
    count++;
    A.clashCount = B.clashCount = count;
    bleedOnToss(b, A.user, A.skill);
    bleedOnToss(b, B.user, B.skill);
    if (!A.user.alive || !B.user.alive) break;
    const ra = rollClash(b, A, B, bDef);
    const rb = rollClash(b, B, A, aDef);
    if (detailed(b)) rounds.push(`Round ${count}: ${ra.detail} vs ${rb.detail}`);
    if (ra.power === rb.power) {
      if (count >= LIMITS.clashCountMax) break;
      continue;
    }
    const [win, lose] = ra.power > rb.power ? [A, B] : [B, A];
    const front = activeCoins(lose)[0];
    const excision = win.coins.some((c) => c.kind === "excision" && !c.destroyed);
    // Unbreakable/Excision coins crack instead of breaking, unless an Excision coin beats them
    if (front.kind !== "normal" && !excision) front.cracked = true;
    else front.destroyed = true;
    if (count >= LIMITS.clashCountMax) break;
  }
  if (!A.user.alive || !B.user.alive) {
    log(b, "clash", `Clash interrupted: ${!A.user.alive ? A.user.name : B.user.name} fell during the Clash.`, rounds);
    return A.user.alive ? A : B.user.alive ? B : null;
  }
  if (activeCoins(A).length && activeCoins(B).length) {
    log(b, "clash", `${A.user.name} (${A.skill.name}) and ${B.user.name} (${B.skill.name}) reached ${count} Clash count: both skills are cancelled.`, rounds, { important: true });
    A.cancelled = B.cancelled = true;
    return null;
  }
  const winner = activeCoins(A).length ? A : B;
  const loser = winner === A ? B : A;
  if (b.metrics) {
    b.metrics.clashRounds += count;
    b.metrics.clashes += 1;
  }
  winner.result = "win";
  loser.result = "lose";
  stat(b, winner.user).clashesWon += 1;
  stat(b, loser.user).clashesLost += 1;
  log(
    b,
    "clash",
    `${winner.user.name}'s ${winner.skill.name} wins the Clash against ${loser.user.name}'s ${loser.skill.name} (${count} round${count === 1 ? "" : "s"}).`,
    rounds,
    { side: winner.user.side, important: true },
  );
  fireSkill("clashWin", { b, self: winner.user, other: loser.user, use: winner, skill: winner.skill });
  fireSkill("clashLose", { b, self: loser.user, other: winner.user, use: loser, skill: loser.skill });
  fireUnit("onClashWinAny", { b, self: winner.user, other: loser.user, use: winner, skill: winner.skill });
  fireUnit("onClashLoseAny", { b, self: loser.user, other: winner.user, use: loser, skill: loser.skill });
  if (winner.user.hasSanity) changeSp(b, winner.user, clashWinSp(count), `won a ${count}-round Clash`);
  return winner;
}

/** Full flow after pairing two actions into a Clash. */
export function clashAndAttack(b: BattleState, A: SkillUse, B: SkillUse) {
  const winner = resolveClash(b, A, B);
  if (!winner) return;
  const loser = winner === A ? B : A;
  const w = winner.skill;
  const l = loser.skill;
  // Clashable Guard: a win raises the attacker's Stagger Threshold; a loss shrinks incoming rolls.
  if (w.kind === "guard") {
    raiseThreshold(b, loser.user, winner.lastClashPower, `${w.name} (Clashable Guard)`);
    if (hasCrackedCoins(loser) && canAct(b, loser.user)) runAttack(b, loser, "lose");
    return;
  }
  if (l.kind === "guard") winner.guardPower = loser.lastPower;
  const defenderUse = l.kind !== "attack" ? loser : undefined;
  if (w.kind === "attack" || w.kind === "counter") runAttack(b, winner, "win", true, defenderUse);
  if (hasCrackedCoins(loser) && loser.user.alive && canAct(b, loser.user) && winner.user.alive && (l.kind === "attack" || l.kind === "counter")) {
    runAttack(b, loser, "lose");
  }
}

function hasCrackedCoins(use: SkillUse) {
  return use.coins.some((c) => c.cracked && !c.destroyed);
}

function guardFinalPower(b: BattleState, guard: SkillUse, attacker: SkillUse): number {
  const base = basePower(b, guard).value;
  const acc = newAcc();
  for (const c of guard.coins) {
    if (c.destroyed) continue;
    accPush(acc, tossCoin(b, guard, c));
  }
  let sum = accTotal(acc, base);
  sum += sumParts(finalPowerMods(b, guard));
  const def = defenseLevel(b, guard.user, attacker, guard).value;
  const off = offenseLevel(b, attacker, guard.user).value;
  sum += levelClashBonus(def, off);
  return Math.max(0, sum);
}

// ---------------------------------------------------------------------------------
// Attacks
// ---------------------------------------------------------------------------------
function pickExtraTargets(b: BattleState, use: SkillUse): UnitState[] {
  const weight = Math.max(1, use.skill.atkWeight + sumParts(collectMods("atkWeight", ctxOf(b, use))));
  const main = use.mainTarget;
  const out = [main];
  let budget = weight - (main.slotWeight || 1);
  if (budget <= 0) return out;
  const pool = use.skill.indiscriminate
    ? b.units.filter((u) => u.alive && u.targetable && u.uid !== main.uid && u.uid !== use.user.uid)
    : targetables(b, opposite(use.user.side)).filter((u) => u.uid !== main.uid);
  for (const t of R.shuffle(b.rng, [...pool])) {
    if (budget <= 0) break;
    out.push(t);
    budget -= t.slotWeight || 1;
  }
  return out;
}

/** Safety cap so a "Reuse this coin" rule without a limit can't loop forever. */
const MAX_REUSE = 5;

interface DefenseState {
  guard?: SkillUse; // the defense skill whose Defense Level applies during this attack
  evade?: Readied;
  evadeStarted?: boolean;
}

/**
 * The one-sided part of a skill: every coin hits every target.
 * mode: "win" after winning a Clash, "lose" for cracked Unbreakable coins after losing, null when unopposed.
 */
export function runAttack(b: BattleState, use: SkillUse, mode: "win" | "lose" | null, allowCounter = true, defenderUse?: SkillUse) {
  const user = use.user;
  if (!user.alive) return;
  if (!use.mainTarget.alive || !use.mainTarget.targetable) {
    const alt = targetables(b, opposite(user.side))[0];
    if (!alt) return;
    use.mainTarget = alt;
  }
  use.targets = pickExtraTargets(b, use);
  const baseCtx: Ctx = { b, self: user, other: use.mainTarget, mainTarget: use.mainTarget, use, skill: use.skill };
  fireSkill("beforeAttack", baseCtx);
  if (!use.clashed) fireSkill("unopposedAttack", baseCtx);

  // Defense skills on each target (only against attacks that did not clash with that unit)
  const defense = new Map<string, DefenseState>();
  for (const t of use.targets) {
    const ds: DefenseState = {};
    if (mode === null || t.uid !== use.mainTarget.uid) {
      const ready = readiedFor(b, t);
      const guard = ready.find((r) => r.skill.kind === "guard" && !r.skill.clashable);
      if (guard && canAct(b, t)) {
        guard.used = true;
        const gUse = newUse(b, { id: guard.actionId, uid: t.uid, side: t.side, slot: 0, skill: guard.skill.key, target: user.uid, targetAction: null, resonance: 0 }, t, guard.skill, user);
        onDefenseUse(b, gUse);
        const shield = guardFinalPower(b, gUse, use);
        core(b, t).shield += shield;
        ds.guard = gUse;
        log(b, "effect", `${t.name} Guards with ${guard.skill.name}: +${shield} Shield.`, undefined, { side: t.side });
      }
      const evade = ready.find((r) => r.skill.kind === "evade");
      if (evade && canAct(b, t)) ds.evade = evade;
    } else if (defenderUse && t.uid === defenderUse.user.uid) {
      ds.guard = defenderUse; // the defense skill it clashed with keeps its Defense Level
    }
    defense.set(t.uid, ds);
  }

  const coinsToUse = use.coins.filter((c) => !c.destroyed && (mode !== "lose" || c.cracked));
  const marks: string[] = [];
  const acc = newAcc();
  for (const c of coinsToUse) {
    let reuseLeft = 1;
    let reused = 0;
    let isReuse = false;
    while (reuseLeft > 0) {
      reuseLeft--;
      if (!user.alive || core(b, user).stagger > 0) {
        log(b, "attack", `${user.name}'s ${use.skill.name} is cut short.`);
        finishAttack(b, use, marks);
        return;
      }
      const run: CoinRun = { index: c.index, coin: c, heads: false, crit: false, mods: [], damage: 0, reuse: 0, isReuse };
      fireSkill("coinStart", { ...baseCtx, coin: run });
      bleedOnToss(b, user, use.skill);
      if (!user.alive) {
        finishAttack(b, use, marks);
        return;
      }
      const tossed = tossCoin(b, use, c, run);
      run.heads = tossed.heads;
      if (tossed.heads) use.heads++;
      else use.tails++;
      accPush(acc, tossed);
      marks.push(tossed.paralyzed ? "P" : tossed.heads ? "H" : "T");
      const bp = basePower(b, use, run);
      const fpParts = finalPowerMods(b, use, run);
      const roll = Math.max(0, accTotal(acc, bp.value) + sumParts(fpParts));

      for (const t of use.targets) {
        if (!t.alive || !user.alive) continue;
        const ds = defense.get(t.uid) ?? {};
        if (ds.evade && !ds.evade.used && !ds.evade.failed) {
          const eUse = newUse(b, { id: ds.evade.actionId, uid: t.uid, side: t.side, slot: 0, skill: ds.evade.skill.key, target: user.uid, targetAction: null, resonance: 0 }, t, ds.evade.skill, user);
          if (!ds.evadeStarted) {
            ds.evadeStarted = true;
            onDefenseUse(b, eUse);
          }
          const ePow = guardFinalPower(b, eUse, use);
          if (ePow >= roll) {
            log(b, "attack", `${t.name} evades coin ${c.index} (${ePow} vs ${roll}).`, undefined, { side: t.side });
            fireSkill("onEvade", { b, self: t, other: user, use: eUse, skill: eUse.skill });
            if (b.hits) b.hits.push(hitStub(b, use, t, run, roll, true));
            ds.guard = ds.guard ?? eUse;
            continue;
          }
          ds.evade.failed = true;
          log(b, "attack", `${t.name}'s Evade fails (${ePow} vs ${roll}).`, undefined, { side: t.side });
        }
        hitTarget(b, use, t, run, roll, ds.guard);
      }
      fireSkill("coinAttackEnd", { ...baseCtx, coin: run });
      if (run.reuse > 0 && reused < MAX_REUSE) {
        const n = Math.min(run.reuse, MAX_REUSE - reused);
        reused += n;
        reuseLeft += n;
        isReuse = true;
        log(b, "attack", `${user.name} reuses coin ${c.index}.`);
      }
    }
  }
  finishAttack(b, use, marks);

  // Counters: after the attack ends, each surviving target may counter once per turn.
  if (allowCounter && user.alive) {
    for (const t of use.targets) {
      if (!t.alive || !canAct(b, t) || !user.alive) continue;
      const counter = readiedFor(b, t).find((r) => r.skill.kind === "counter" && !r.skill.clashable);
      if (!counter) continue;
      counter.used = true;
      const cUse = newUse(b, { id: counter.actionId, uid: t.uid, side: t.side, slot: 0, skill: counter.skill.key, target: user.uid, targetAction: null, resonance: 0 }, t, counter.skill, user);
      log(b, "attack", `${t.name} counters with ${counter.skill.name}!`, undefined, { side: t.side, important: true });
      onDefenseUse(b, cUse);
      runAttack(b, cUse, null, false);
    }
  }
}

function finishAttack(b: BattleState, use: SkillUse, marks: string[]) {
  if (marks.length)
    log(b, "attack", `${use.user.name}'s ${use.skill.name}: ${marks.join(" ")} → ${use.damage} total damage.`, undefined, { side: use.user.side });
  fireSkill("attackEnd", { b, self: use.user, other: use.mainTarget, mainTarget: use.mainTarget, use, skill: use.skill });
}

export function onDefenseUse(b: BattleState, use: SkillUse) {
  const s = use.skill;
  if (s.sin && use.user.side === "ally") b.resources[use.user.side][s.sin] += 1;
  fireSkill("onUse", { b, self: use.user, other: use.mainTarget, use, skill: s });
  fireUnit("onSkillUse", { b, self: use.user, other: use.mainTarget, use, skill: s });
}

function hitStub(b: BattleState, use: SkillUse, t: UnitState, run: CoinRun, roll: number, evaded: boolean): HitRecord {
  return {
    turn: b.turn, attacker: use.user.name, target: t.name, skill: use.skill.name, coin: run.index, heads: run.heads, crit: false,
    roll, rollBeforeGuard: roll, offLevel: 0, defLevel: 0, staticParts: [], dynamicParts: [], raw: 0, final: 0, floorApplied: "none", extra: [], evaded,
  };
}

/** One coin hitting one target: crit roll, damage formula, on-hit statuses and triggers. */
function hitTarget(b: BattleState, use: SkillUse, t: UnitState, run: CoinRun, rollIn: number, defUse: SkillUse | undefined) {
  const user = use.user;
  // A coin can deal its own damage type / sin ("This coin deals Slash damage").
  const skill: CSkill =
    run.coin.dmgType || run.coin.sin
      ? { ...use.skill, dmgType: run.coin.dmgType ?? use.skill.dmgType, sin: run.coin.sin ?? use.skill.sin }
      : use.skill;
  let roll = rollIn;
  if (use.guardPower && t.uid === use.mainTarget.uid) roll = guardReducedRoll(rollIn, use.guardPower);

  const ctx: Ctx = { b, self: user, other: t, mainTarget: use.mainTarget, use, skill, coin: run };
  // ---- critical hit
  const poise = getStatus(user, "POISE");
  let critChance = poise ? poiseCritChance(poise.potency) : 0;
  critChance += sumParts(collectMods("critChance", ctx)) / 100;
  let crit = critChance > 0 && R.chance(b.rng, Math.min(1, critChance));
  if (b.settings.forceCrit === "always") crit = critChance > 0;
  if (b.settings.forceCrit === "never") crit = false;
  if (crit && poise) reduceStatus(b, user, "POISE", "count", 1);
  run.crit = crit;

  // ---- static modifier
  const off = offenseLevel(b, use, t, run);
  const def = defenseLevel(b, t, use, defUse);
  const staticParts: ModPart[] = [];
  if (skill.sin) {
    const x = resistValue(b, t, "sin", skill.sin, ctx);
    staticParts.push({ label: `${SIN_LABEL[skill.sin]} ${resistTierName(x)} ×${fmt(x)}`, value: resistMod(x) });
  }
  const st = staggerLevel(b, t);
  const physX = t.broken && t.breakable === "destructible" ? 2 : resistValue(b, t, "phys", skill.dmgType, ctx);
  staticParts.push({
    label: st > 0 ? `${DMG_LABEL[skill.dmgType]} (${["", "Stagger", "Stagger+", "Stagger++"][st]})` : `${DMG_LABEL[skill.dmgType]} ${resistTierName(physX)} ×${fmt(physX)}`,
    value: physResistMod(physX, st),
  });
  staticParts.push({ label: `Offense ${off.value} vs Defense ${def.value}`, value: levelAdvantage(off.value, def.value) });
  if (crit) staticParts.push({ label: "Critical Hit", value: critModifier(0, 0) });
  if (use.clashCount) staticParts.push({ label: `Clash count ${use.clashCount}`, value: clashCountMod(use.clashCount) });

  // ---- dynamic modifier
  const dynamicParts: ModPart[] = [];
  const addStatusPct = (u: UnitState, key: string, label: string, sign: number) => {
    const v = statusValue(b, u, key);
    if (v) dynamicParts.push({ label: `${label} ${v}`, value: sign * 0.1 * Math.min(10, v) });
  };
  addStatusPct(user, "DAMAGE_UP", "Damage Up", 1);
  addStatusPct(user, "DAMAGE_DOWN", "Damage Down", -1);
  addStatusPct(user, `${skill.dmgType}_DMG_UP`, `${DMG_LABEL[skill.dmgType]} DMG Up`, 1);
  addStatusPct(user, `${skill.dmgType}_DMG_DOWN`, `${DMG_LABEL[skill.dmgType]} DMG Down`, -1);
  if (skill.sin) {
    addStatusPct(user, `${skill.sin}_DMG_UP`, `${SIN_LABEL[skill.sin]} DMG Up`, 1);
    addStatusPct(user, `${skill.sin}_DMG_DOWN`, `${SIN_LABEL[skill.sin]} DMG Down`, -1);
  }
  addStatusPct(t, "FRAGILE", "Fragile", 1);
  addStatusPct(t, "PROTECTION", "Protection", -1);
  addStatusPct(t, `${skill.dmgType}_FRAGILITY`, `${DMG_LABEL[skill.dmgType]} Fragility`, 1);
  addStatusPct(t, `${skill.dmgType}_PROTECTION`, `${DMG_LABEL[skill.dmgType]} Protection`, -1);
  if (skill.sin) {
    addStatusPct(t, `${skill.sin}_FRAGILITY`, `${SIN_LABEL[skill.sin]} Fragility`, 1);
    addStatusPct(t, `${skill.sin}_PROTECTION`, `${SIN_LABEL[skill.sin]} Protection`, -1);
  }
  if (crit) {
    const cdu = statusValue(b, user, "CRIT_DMG_UP");
    if (cdu) dynamicParts.push({ label: `Crit DMG Up ${cdu}`, value: 0.1 * cdu });
    for (const p of collectMods("critDmg", ctx)) dynamicParts.push({ label: p.label + " (crit)", value: p.value / 100 });
  }
  for (const p of collectMods("dmgDealt", ctx)) dynamicParts.push({ label: p.label, value: p.value / 100 });
  const tctx: Ctx = { b, self: t, other: user, use, skill, coin: run };
  for (const p of collectMods("dmgTaken", tctx)) dynamicParts.push({ label: `${p.label} (${t.name})`, value: p.value / 100 });

  const res = finalDamage({ coinRoll: roll, staticParts, dynamicParts });
  const dealt = applyDamage(b, t, res.final, { label: skill.name, by: user, canStagger: false });
  run.damage = res.final;
  use.damage += dealt;

  const rec: HitRecord | null = b.hits
    ? {
        turn: b.turn, attacker: user.name, target: t.name, skill: skill.name, coin: run.index, heads: run.heads, crit,
        roll, rollBeforeGuard: rollIn, offLevel: off.value, defLevel: def.value, staticParts, dynamicParts,
        raw: res.raw, final: res.final, floorApplied: res.floorApplied, extra: [],
      }
    : null;
  if (rec) b.hits!.push(rec);

  if (detailed(b)) {
    const lines = [
      `Coin roll ${roll}${roll !== rollIn ? ` (was ${rollIn}, reduced by Clashable Guard)` : ""}`,
      `Static ${pct(res.staticTotal)}: ${staticParts.map((p) => `${p.label} ${pct(p.value)}`).join(" · ")}`,
      `Dynamic ${pct(res.dynamicTotal)}${dynamicParts.length ? ": " + dynamicParts.map((p) => `${p.label} ${pct(p.value)}`).join(" · ") : ""}`,
      `${roll} × ${fmt(1 + res.staticTotal, 4)} × ${fmt(1 + res.dynamicTotal, 4)} = ${fmt(res.raw, 3)} → ${res.final}${res.floorApplied === "fivePercent" ? " (5% minimum)" : res.floorApplied === "minimumOne" ? " (minimum 1)" : ""}`,
    ];
    log(b, "damage", `${user.name} → ${t.name}: coin ${run.index}${run.isReuse ? " (reuse)" : ""} ${run.heads ? "Heads" : "Tails"}${crit ? ", CRIT" : ""}: ${res.final} damage`, lines, { side: user.side });
  }

  // ---- statuses that trigger when hit (consumed before new inflictions)
  if (t.alive) {
    const rup = getStatus(t, "RUPTURE");
    if (rup) {
      const n = rup.potency;
      reduceStatus(b, t, "RUPTURE", "count", 1);
      const d = dealFixedDamage(b, t, n, { label: "Rupture", by: user, canStagger: false, status: "RUPTURE" });
      if (rec) rec.extra.push({ label: "Rupture", value: d });
    }
  }
  if (t.alive) {
    const sink = getStatus(t, "SINKING");
    if (sink) {
      const n = sink.potency;
      reduceStatus(b, t, "SINKING", "count", 1);
      if (t.hasSanity && !(t.side === "ally" && t.panic === "panic")) changeSp(b, t, -n, "Sinking");
      else {
        const d = dealFixedDamage(b, t, n, { label: "Sinking", by: user, canStagger: false, sin: "GLOOM", status: "SINKING" });
        if (rec) rec.extra.push({ label: "Sinking (Gloom)", value: d });
      }
    }
  }

  // ---- coin & unit triggers
  const hitCtx: Ctx = { ...ctx, damage: res.final };
  const before = use.damage;
  fireSkill("onHit", hitCtx);
  fireSkill(run.heads ? "headsHit" : "tailsHit", hitCtx);
  if (use.result === "win") fireSkill("hitAfterClashWin", hitCtx);
  if (use.result === "lose") fireSkill("hitAfterClashLose", hitCtx);
  if (run.coin.kind !== "normal" && !run.coin.cracked) fireSkill("hitWithoutCracking", hitCtx);
  if (crit) fireSkill("onCrit", hitCtx);
  if (t.alive) fireUnit("whenHit", { b, self: t, other: user, use, skill, coin: run, damage: res.final });
  fireUnit("onHitDealt", { ...hitCtx });
  if (rec && use.damage > before) rec.extra.push({ label: "Effects", value: use.damage - before });

  // ---- Stagger (also when HP was already under an untriggered threshold) and death
  if (t.alive && core(b, t).shield <= 0) checkStagger(b, t, false);
  if (!core(b, t).alive) {
    fireSkill("coinKill", hitCtx);
    fireSkill("onKill", hitCtx);
  }
}

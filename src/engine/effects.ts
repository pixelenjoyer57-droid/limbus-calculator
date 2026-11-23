// Effect rules: "When <trigger>, if <conditions>, do <actions>".
// This module evaluates quantities/conditions, picks units, runs actions and
// collects numeric modifiers ("+20% damage", "Coin Power +1") for the combat code.
import type { Action, Condition, Effect, ModStat, Quantity, Trigger, Value, Who } from "../data/schema";
import { SINS, type DmgType, type Sin } from "./constants";
import * as R from "./rng";
import {
  addStatus, bodies, core, fmt, hasStatus, log, negativeCount, opposite, positiveCount, reduceStatus,
  cleanupStatus, removeStatus, sideUnits, statusDef, statusName, statusTotal, staggerLevel, targetables, unit,
} from "./state";
import type { BattleState, CSkill, TempMod, UnitState } from "./types";
import {
  changeSp, dealFixedDamage, forceStagger, healHp, raiseThreshold, sinkingDeluge, tremorBurst, typedResistFactor,
} from "./combat";
import type { TremorType } from "./statuses";

export interface CoinState {
  kind: "normal" | "unbreakable" | "excision";
  effects: Effect[]; // the coin's own rules
  typeEffects: Effect[]; // rules of its custom coin type
  index: number; // 1-based position in the skill
  destroyed: boolean;
  cracked: boolean;
  power: number | null; // own Coin Power (null = the skill's)
  op: "add" | "multiply";
  mult: number;
  dmgType: DmgType | null;
  sin: Sin | null;
  headsBonus: number; // percentage points
  fixed: "heads" | "tails" | null;
  ignoreParalyze: boolean;
  crackedPower: number;
  typeName?: string;
}

export interface CoinRun {
  index: number;
  coin: CoinState;
  heads: boolean;
  crit: boolean;
  mods: TempMod[];
  damage: number;
  reuse: number;
  isReuse: boolean;
}

export interface SkillUse {
  actionId: string;
  user: UnitState;
  skill: CSkill;
  mainTarget: UnitState;
  targets: UnitState[];
  coins: CoinState[];
  mods: TempMod[];
  clashCount: number;
  clashed: boolean;
  result: "win" | "lose" | null;
  heads: number;
  tails: number;
  damage: number;
  resonance: number;
  isEgo: boolean;
  defending: boolean;
  guardPower: number; // Clashable Guard that lost against this skill reduces each roll
  cancelled: boolean;
  lastPower: number; // Final Power of the last Clash round
  lastClashPower: number;
  /** Times each rule fired during this use (for the per-Skill limit). */
  useLimits?: Record<string, number>;
}

export interface Ctx {
  b: BattleState;
  self: UnitState;
  other?: UnitState;
  mainTarget?: UnitState;
  use?: SkillUse; // the skill use this context belongs to (self's own skill, or the incoming one)
  skill?: CSkill; // skill relevant for skill* conditions
  coin?: CoinRun;
  damage?: number;
  statusEvent?: { key: string; potency: number; count: number };
  depth?: number;
}

export const SKILL_TRIGGERS: Trigger[] = ["onUse", "clashStart", "clashWin", "clashLose", "beforeAttack", "unopposedAttack", "attackEnd", "onKill", "onEvade"];
export const COIN_TRIGGERS: Trigger[] = ["coinStart", "onHit", "headsHit", "tailsHit", "hitAfterClashWin", "hitAfterClashLose", "hitWithoutCracking", "onCrit", "coinKill", "coinAttackEnd"];
export const UNIT_TRIGGERS: Trigger[] = ["encounterStart", "turnStart", "combatStart", "turnEnd", "whenHit", "onHitDealt", "onSkillUse", "onClashWinAny", "onClashLoseAny", "onKillAny", "onAllyDeath", "onEnemyStaggered", "whenStaggered", "onInflictStatus"];
export const GLOBAL_TRIGGERS: Trigger[] = ["encounterStart", "turnStart", "combatStart", "turnEnd"];

// ---------------------------------------------------------------------------------
// Quantities, values, conditions
// ---------------------------------------------------------------------------------
function quantityUnit(q: { who: Who }, ctx: Ctx): UnitState | undefined {
  switch (q.who) {
    case "self":
      return ctx.self;
    case "target":
      return ctx.other;
    case "mainTarget":
      return ctx.mainTarget ?? ctx.use?.mainTarget ?? ctx.other;
    default:
      return pickUnits(q.who, ctx, 1, false)[0];
  }
}

export function evalQuantity(q: Quantity, ctx: Ctx): number {
  const { b } = ctx;
  const u = quantityUnit(q, ctx);
  switch (q.kind) {
    case "statusPotency":
      return u ? statusTotal(b, u, q.status, "potency") : 0;
    case "statusCount":
      return u ? statusTotal(b, u, q.status, "count") : 0;
    case "statusSum":
      return u ? statusTotal(b, u, q.status, "potency") + statusTotal(b, u, q.status, "count") : 0;
    case "statusOnAllEnemies":
      return targetables(b, opposite(ctx.self.side)).reduce((a, e) => a + statusTotal(b, e, q.status, q.field), 0);
    case "hp":
      return u ? core(b, u).hp : 0;
    case "hpPct": {
      const c = u && core(b, u);
      return c ? (100 * c.hp) / c.maxHp : 0;
    }
    case "missingHp": {
      const c = u && core(b, u);
      return c ? c.maxHp - c.hp : 0;
    }
    case "missingHpPct": {
      const c = u && core(b, u);
      return c ? (100 * (c.maxHp - c.hp)) / c.maxHp : 0;
    }
    case "maxHp":
      return u ? core(b, u).maxHp : 0;
    case "sp":
      return u && u.hasSanity ? u.sp : 0;
    case "speed":
      return u ? u.speed : 0;
    case "speedDiff":
      return ctx.other ? ctx.self.speed - ctx.other.speed : 0;
    case "level":
      return u ? u.level : 0;
    case "staggerLevel":
      return u ? staggerLevel(b, u) : 0;
    case "shield":
      return u ? core(b, u).shield : 0;
    case "negativeEffects":
      return u ? negativeCount(b, u) : 0;
    case "positiveEffects":
      return u ? positiveCount(b, u) : 0;
    case "clashCount":
      return ctx.use?.clashCount ?? 0;
    case "headsCount":
      return ctx.use?.heads ?? 0;
    case "tailsCount":
      return ctx.use?.tails ?? 0;
    case "coinIndex":
      return ctx.coin?.index ?? 0;
    case "coinCount":
      return ctx.use ? ctx.use.coins.filter((c) => !c.destroyed).length : ctx.skill?.coins.length ?? 0;
    case "turn":
      return b.turn;
    case "alliesAlive":
      return bodies(b, ctx.self.side).length;
    case "enemiesAlive":
      return bodies(b, opposite(ctx.self.side)).length;
    case "alliesDead":
      return b.units.filter((x) => x.side === ctx.self.side && !x.alive && x.kind !== "part").length;
    case "resonance":
      return ctx.self.side === "ally" ? b.resonance[q.sin] ?? 0 : 0;
    case "owned":
      return b.resources[ctx.self.side][q.sin] ?? 0;
    case "damageDealt":
      return ctx.damage ?? ctx.coin?.damage ?? 0;
    case "skillDamage":
      return ctx.use?.damage ?? 0;
  }
  return 0;
}

export function evalValue(v: Value, ctx: Ctx): number {
  let x = v.base;
  if (v.per) {
    const q = evalQuantity(v.per.q, ctx) + (v.per.q2 ? evalQuantity(v.per.q2, ctx) : 0);
    const every = v.per.every || 1;
    x += Math.floor(q / every + 1e-9) * v.per.amount;
  }
  if (v.max !== null && v.max !== undefined) x = Math.min(v.max, x);
  if (v.min !== null && v.min !== undefined) x = Math.max(v.min, x);
  return x;
}

function compare(a: number, op: string, b: number): boolean {
  switch (op) {
    case ">=":
      return a >= b;
    case "<=":
      return a <= b;
    case ">":
      return a > b;
    case "<":
      return a < b;
    case "==":
      return Math.abs(a - b) < 1e-9;
    case "!=":
      return Math.abs(a - b) >= 1e-9;
  }
  return false;
}

export function skillInflicts(skill: CSkill | undefined, status: string): boolean {
  if (!skill) return false;
  const all = [...skill.effects, ...skill.coins.flatMap((c) => c.effects)];
  return all.some((e) => e.actions.some((a) => a.kind === "inflict" && a.status === status));
}

export function checkCondition(c: Condition, ctx: Ctx): boolean {
  const r = rawCondition(c, ctx);
  return c.not ? !r : r;
}

function rawCondition(c: Condition, ctx: Ctx): boolean {
  const { b } = ctx;
  const who = () => quantityUnit({ who: c.who }, ctx);
  switch (c.kind) {
    case "compare":
      return c.q ? compare(evalQuantity(c.q, ctx) + (c.q2 ? evalQuantity(c.q2, ctx) : 0), c.op, c.value) : false;
    case "hasStatus": {
      const u = who();
      return !!u && hasStatus(b, u, c.status);
    }
    case "isStaggered": {
      const u = who();
      return !!u && staggerLevel(b, u) > 0;
    }
    case "isHeads":
      return !!ctx.coin && ctx.coin.heads;
    case "isTails":
      return !!ctx.coin && !ctx.coin.heads;
    case "isCrit":
      return !!ctx.coin && ctx.coin.crit;
    case "isReuse":
      return !!ctx.coin && ctx.coin.isReuse;
    case "skillSin":
      return ctx.skill?.sin === c.sin;
    case "skillDmgType":
      return !!ctx.skill && ctx.skill.kind !== "guard" && ctx.skill.kind !== "evade" && ctx.skill.dmgType === c.dmgType;
    case "skillSlot":
      return !!ctx.skill && (ctx.skill.slot === c.slot || (c.slot === "DEF" && ctx.skill.kind !== "attack" && ctx.skill.slot !== "EGO"));
    case "skillInflicts":
      return skillInflicts(ctx.skill, c.status);
    case "clashWon":
      return ctx.use?.result === "win";
    case "clashLost":
      return ctx.use?.result === "lose";
    case "unopposed":
      return !!ctx.use && !ctx.use.clashed;
    case "chance":
      return R.chance(b.rng, c.value / 100);
    case "absoluteResonance":
      return ctx.self.side === "ally" && !!b.aResonance[c.sin];
    case "targetIsEnemy":
      return !!ctx.other && ctx.other.side !== ctx.self.side;
    case "sinner":
      return ctx.self.sinner === c.text;
    case "trait":
      return ctx.self.traits.some((t) => t.toLowerCase() === c.text.toLowerCase());
    case "isPanicked": {
      const u = who();
      return !!u && u.panic !== "none";
    }
    case "statusIs":
      return !!ctx.statusEvent && (ctx.statusEvent.key === c.status || statusDef(b, ctx.statusEvent.key)?.countsAs === c.status);
  }
  return false;
}

// ---------------------------------------------------------------------------------
// Unit selection
// ---------------------------------------------------------------------------------
export function pickUnits(who: Who, ctx: Ctx, count = 1, forAction = true): UnitState[] {
  const { b, self } = ctx;
  const allies = sideUnits(b, self.side).filter((u) => u.targetable);
  const enemies = targetables(b, opposite(self.side));
  const sortBy = (arr: UnitState[], f: (u: UnitState) => number) => [...arr].sort((x, y) => f(x) - f(y));
  switch (who) {
    case "self":
      return [self];
    case "target":
      return ctx.other ? [ctx.other] : [];
    case "mainTarget": {
      const t = ctx.mainTarget ?? ctx.use?.mainTarget ?? ctx.other;
      return t ? [t] : [];
    }
    case "allAllies":
      return allies;
    case "otherAllies":
      return allies.filter((u) => u.uid !== self.uid);
    case "allEnemies":
      return enemies;
    case "randomEnemy":
      return forAction ? R.shuffle(b.rng, [...enemies]).slice(0, count) : enemies.slice(0, 1);
    case "randomAlly":
      return forAction ? R.shuffle(b.rng, [...allies]).slice(0, count) : allies.slice(0, 1);
    case "lowestHpAlly":
      return sortBy(allies, (u) => core(b, u).hp / core(b, u).maxHp).slice(0, count);
    case "lowestSpAlly":
      return sortBy(allies.filter((u) => u.hasSanity), (u) => u.sp).slice(0, count);
    case "fastestAlly":
      return sortBy(allies, (u) => -u.speed).slice(0, count);
    case "slowestAlly":
      return sortBy(allies, (u) => u.speed).slice(0, count);
    case "lowestHpEnemy":
      return sortBy(enemies, (u) => core(b, u).hp / core(b, u).maxHp).slice(0, count);
    case "fastestEnemy":
      return sortBy(enemies, (u) => -u.speed).slice(0, count);
    case "alliesAfterSelf":
      return sortBy(allies.filter((u) => u.uid !== self.uid && u.speed <= self.speed), (u) => -u.speed).slice(0, count);
  }
  return [];
}

// ---------------------------------------------------------------------------------
// Sources of effects owned by a unit
// ---------------------------------------------------------------------------------
export interface EffectSource {
  effect: Effect;
  label: string;
  key: string; // unique id for limit tracking
  team?: boolean; // team-scoped source (support passives, team gifts)
}

/** Effects attached to a unit: active passives, E.G.O passives, custom statuses and E.G.O Gifts. */
export function unitSources(b: BattleState, u: UnitState, includeTeam: boolean): EffectSource[] {
  const out: EffectSource[] = [];
  const passiveKeys = [...u.activePassives, ...u.egoPassives];
  for (const k of passiveKeys) {
    const p = b.content.passives[k];
    if (!p) continue;
    for (const e of p.effects) out.push({ effect: e, label: p.name, key: `${u.uid}:${k}:${e.id}` });
  }
  for (const s of u.statuses) {
    const def = b.content.statuses[s.key];
    if (!def) continue;
    for (const e of def.effects) out.push({ effect: e, label: def.name, key: `${u.uid}:st:${s.key}:${e.id}` });
  }
  if (u.side === "ally") {
    for (const g of b.content.gifts) {
      if (g.scope === "eachAlly" || includeTeam) {
        for (const e of g.effects) out.push({ effect: e, label: g.name, key: `${u.uid}:gift:${g.key}:${e.id}`, team: g.scope === "team" });
      }
    }
    if (includeTeam) {
      for (const k of teamSupportPassives(b)) {
        const p = b.content.passives[k];
        if (!p) continue;
        for (const e of p.effects) out.push({ effect: e, label: p.name + " (support)", key: `team:${k}:${e.id}`, team: true });
      }
    }
  }
  return out;
}

/** Support passives of benched team members whose requirement is met this turn. */
export function teamSupportPassives(b: BattleState): string[] {
  const keys: string[] = [];
  for (const u of b.units) {
    if (u.side !== "ally" || u.kind !== "identity") continue;
    // bench units are stored with alive=false & targetable=false and deployOrder < 0
    if (u.deployOrder >= 0) continue;
    for (const k of u.supportPassives) if (passiveRequirementMet(b, k, "ally")) keys.push(k);
  }
  return keys;
}

export function passiveRequirementMet(b: BattleState, key: string, side: "ally" | "enemy"): boolean {
  const p = b.content.passives[key];
  if (!p) return false;
  if (p.reqMode === "none" || b.settings.assumePassives) return true;
  if (p.reqMode === "owned") return (b.resources[side][p.reqSin] ?? 0) >= p.reqCount;
  return side === "ally" && (b.resonance[p.reqSin] ?? 0) >= p.reqCount;
}

// ---------------------------------------------------------------------------------
// Firing triggers
// ---------------------------------------------------------------------------------
function limitOk(ctx: Ctx, src: EffectSource): boolean {
  const e = src.effect;
  const owner = ctx.self;
  if (e.perTurn > 0 && (owner.limits[src.key] ?? 0) >= e.perTurn) return false;
  if (e.perEncounter > 0 && (owner.encLimits[src.key] ?? 0) >= e.perEncounter) return false;
  if (e.perUse > 0 && ctx.use && (ctx.use.useLimits?.[src.key] ?? 0) >= e.perUse) return false;
  return true;
}

function consumeLimit(ctx: Ctx, src: EffectSource) {
  const e = src.effect;
  if (e.perTurn > 0) ctx.self.limits[src.key] = (ctx.self.limits[src.key] ?? 0) + 1;
  if (e.perEncounter > 0) ctx.self.encLimits[src.key] = (ctx.self.encLimits[src.key] ?? 0) + 1;
  if (e.perUse > 0 && ctx.use) {
    const m = (ctx.use.useLimits ??= {});
    m[src.key] = (m[src.key] ?? 0) + 1;
  }
}

export function runSource(src: EffectSource, ctx: Ctx): boolean {
  if ((ctx.depth ?? 0) > 6) return false;
  if (!limitOk(ctx, src)) return false;
  for (const c of src.effect.conditions) if (!checkCondition(c, ctx)) return false;
  consumeLimit(ctx, src);
  for (const a of src.effect.actions) runAction(a, ctx, src.label);
  return true;
}

/** Fire a skill-level or coin-level trigger for the skill in `ctx.use`. */
export function fireSkill(trigger: Trigger, ctx: Ctx) {
  const use = ctx.use;
  if (!use) return;
  const skill = use.skill;
  const sources: EffectSource[] = [];
  for (const e of skill.effects) if (e.trigger === trigger) sources.push({ effect: e, label: skill.name, key: `${use.user.uid}:${skill.key}:${e.id}` });
  if (ctx.coin) {
    const c = ctx.coin.coin;
    for (const e of c.effects)
      if (e.trigger === trigger) sources.push({ effect: e, label: `${skill.name} coin ${ctx.coin.index}`, key: `${use.user.uid}:${skill.key}:c${ctx.coin.index}:${e.id}` });
    for (const e of c.typeEffects ?? [])
      if (e.trigger === trigger) sources.push({ effect: e, label: `${c.typeName ?? "Coin type"} (coin ${ctx.coin.index})`, key: `${use.user.uid}:${skill.key}:c${ctx.coin.index}:t:${e.id}` });
  }
  for (const s of sources) runSource(s, { ...ctx, skill: ctx.skill ?? skill });
}

/** Fire a unit-level trigger for one unit (passives, E.G.O passives, statuses, each-ally gifts). */
export function fireUnit(trigger: Trigger, ctx: Ctx) {
  if (!ctx.self.alive && trigger !== "onAllyDeath") return;
  for (const s of unitSources(ctx.b, ctx.self, false)) if (s.effect.trigger === trigger) runSource(s, ctx);
}

/** Fire team-scoped sources (team gifts, support passives) once for global triggers. */
export function fireTeam(trigger: Trigger, b: BattleState) {
  const rep = sideUnits(b, "ally").filter((u) => u.targetable)[0];
  if (!rep) return;
  const all = unitSources(b, rep, true).filter((s) => s.team && s.effect.trigger === trigger);
  for (const s of all) runSource(s, { b, self: rep });
}

// ---------------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------------
let inflictHandlerDepth = 0;

export function runAction(a: Action, ctx: Ctx, label: string) {
  const { b } = ctx;
  const targets = () => pickUnits(a.who, ctx, a.count, true);
  const amount = () => evalValue(a.amount, ctx);
  switch (a.kind) {
    case "inflict": {
      const def = statusDef(b, a.status);
      if (!def) return;
      const potency = def.mode === "pc" ? Math.floor(evalValue(a.potency, ctx)) : 0;
      const count = Math.floor(amount());
      for (const t of targets()) inflictStatus(ctx, t, a.status, potency, count, a.timing, label);
      return;
    }
    case "reduceStatus": {
      const n = Math.floor(amount());
      for (const t of targets()) {
        const removed = reduceStatus(b, t, a.status, a.field, n);
        if (removed) log(b, "status", `${t.name}: −${removed} ${statusName(b, a.status)} ${a.field === "count" ? "Count" : "Potency"} (${label})`);
      }
      return;
    }
    case "removeStatus":
      for (const t of targets()) removeStatus(t, a.status);
      return;
    case "healHp": {
      for (const t of targets()) {
        const c = core(b, t);
        const base = amount();
        const n = a.hpMode === "pctMax" ? (c.maxHp * base) / 100 : a.hpMode === "pctMissing" ? ((c.maxHp - c.hp) * base) / 100 : base;
        healHp(b, t, Math.floor(n), label);
      }
      return;
    }
    case "loseHp": {
      for (const t of targets()) {
        const c = core(b, t);
        const base = amount();
        const n = a.hpMode === "pctMax" ? (c.maxHp * base) / 100 : a.hpMode === "pctMissing" ? ((c.maxHp - c.hp) * base) / 100 : base;
        dealFixedDamage(b, t, Math.floor(n), { label, by: ctx.self, canStagger: false, sin: null });
      }
      return;
    }
    case "fixedDamage": {
      for (const t of targets()) dealFixedDamage(b, t, Math.floor(amount()), { label, by: ctx.self, canStagger: true, sin: a.sin, dmgType: a.dmgType });
      return;
    }
    case "coinDamagePct": {
      const base = ctx.damage ?? ctx.coin?.damage ?? 0;
      const n = Math.floor((base * amount()) / 100);
      for (const t of targets()) dealFixedDamage(b, t, n, { label, by: ctx.self, canStagger: true, sin: a.sin, dmgType: a.dmgType, adder: true });
      return;
    }
    case "healSp":
      for (const t of targets()) changeSp(b, t, Math.floor(amount()), label);
      return;
    case "loseSp":
      for (const t of targets()) changeSp(b, t, -Math.floor(amount()), label);
      return;
    case "shield": {
      for (const t of targets()) {
        const c = core(b, t);
        const base = amount();
        const n = Math.floor(a.hpMode === "pctMax" ? (c.maxHp * base) / 100 : base);
        if (n > 0) {
          c.shield += n;
          log(b, "effect", `${t.name} gains ${n} Shield (${label})`);
        }
      }
      return;
    }
    case "tremorBurst": {
      const times = Math.max(1, Math.floor(amount()));
      for (const t of targets()) for (let i = 0; i < times; i++) tremorBurst(b, t, ctx.self, label);
      return;
    }
    case "convertTremor": {
      for (const t of targets()) {
        const s = t.statuses.find((x) => x.key === "TREMOR");
        if (!s) continue;
        const type = a.tremorType as TremorType;
        if (a.entangle || s.entangled) {
          s.tremorTypes = Array.from(new Set([...(s.tremorTypes ?? []), type]));
          s.entangled = true;
        } else s.tremorTypes = [type];
        log(b, "status", `${t.name}'s Tremor becomes ${s.tremorTypes.join(" + ")} (${label})`);
      }
      return;
    }
    case "sinkingDeluge":
      for (const t of targets()) sinkingDeluge(b, t, ctx.self, label);
      return;
    case "raiseStaggerThreshold":
      for (const t of targets()) raiseThreshold(b, t, Math.floor(amount()), label);
      return;
    case "gainResource": {
      const sin: Sin = a.sin ?? ctx.skill?.sin ?? "WRATH";
      const n = Math.floor(amount());
      const res = b.resources[ctx.self.side];
      res[sin] = Math.max(0, (res[sin] ?? 0) + n);
      log(b, "effect", `${n >= 0 ? "+" : ""}${n} ${sin} E.G.O resource (${label})`);
      return;
    }
    case "reuseCoin":
      if (ctx.coin) ctx.coin.reuse += Math.max(1, Math.floor(amount()));
      return;
    case "forceStagger":
      for (const t of targets()) forceStagger(b, t, label);
      return;
    case "mod": {
      const value = amount();
      if (!value) return;
      const mod: TempMod = { stat: a.stat, value, sin: a.sin, dmgType: a.dmgType, status: a.stat === "statusDmgTaken" ? a.status : undefined, coin: a.coin || undefined, label };
      for (const t of targets()) {
        if (a.scope === "skill" && ctx.use && ctx.use.user.uid === t.uid) ctx.use.mods.push(mod);
        else if (a.scope === "coin" && ctx.coin && ctx.use?.user.uid === t.uid) ctx.coin.mods.push(mod);
        else if (a.scope === "nextTurn") t.pendingMods.push(mod);
        else t.mods.push(mod);
      }
      return;
    }
    case "triggerStatus": {
      const times = Math.min(10, Math.max(1, Math.floor(amount())));
      for (const t of targets()) triggerStatus(ctx, t, a.status, times, label);
      return;
    }
    case "note":
      return;
  }
}

const TRIGGER_KINDS = ["BURN", "BLEED", "RUPTURE", "SINKING", "TREMOR", "POISON"];

/** "Activate / trigger a status now": applies its effect N times, like the game does when it normally triggers. */
function triggerStatus(ctx: Ctx, t: UnitState, key: string, times: number, label: string) {
  const { b } = ctx;
  const inst = t.statuses.find((s) => s.key === key) ?? t.statuses.find((s) => statusDef(b, s.key)?.countsAs === key);
  const name = statusName(b, key);
  if (!inst || !t.alive) {
    return;
  }
  const kw = TRIGGER_KINDS.includes(inst.key) ? inst.key : statusDef(b, inst.key)?.countsAs;
  if (!kw || !TRIGGER_KINDS.includes(kw)) {
    log(b, "status", `${name} on ${t.name} has nothing to trigger (${label})`);
    return;
  }
  const by = ctx.self;
  for (let i = 0; i < times && t.alive; i++) {
    const s = t.statuses.find((x) => x === inst);
    if (!s) break;
    if (kw === "TREMOR") {
      if (s.key !== "TREMOR") {
        log(b, "status", `${name} on ${t.name} has nothing to trigger (${label})`);
        return;
      }
      tremorBurst(b, t, by, label);
      continue;
    }
    if (kw === "POISON") {
      const n = s.count;
      s.count = Math.floor(s.count / 2);
      cleanupStatus(b, t, s);
      const d = dealFixedDamage(b, t, n, { label: name, by, canStagger: true, status: s.key });
      log(b, "status", `Triggered ${name} on ${t.name}: ${d} damage (${label})`);
      continue;
    }
    const n = s.potency;
    reduceStatus(b, t, s.key, "count", 1);
    if (kw === "SINKING" && t.hasSanity && !(t.side === "ally" && t.panic === "panic")) {
      changeSp(b, t, -n, name);
      log(b, "status", `Triggered ${name} on ${t.name}: ${n} SP damage (${label})`);
      continue;
    }
    const d = dealFixedDamage(b, t, n, {
      label: name, by, canStagger: kw === "BURN", status: s.key, sin: kw === "SINKING" ? "GLOOM" : null,
    });
    log(b, "status", `Triggered ${name} on ${t.name}: ${d} damage (${label})`);
  }
}

/** Inflict a status and fire "When inflicting a status" handlers on the inflicter. */
export function inflictStatus(ctx: Ctx, t: UnitState, key: string, potency: number, count: number, timing: "now" | "nextTurn", label: string) {
  const { b } = ctx;
  const res = addStatus(b, t, key, potency, count, timing);
  if (!res) return;
  const def = statusDef(b, key);
  const what = def?.mode === "pc"
    ? [potency > 0 ? `${potency} ${def.name}` : "", count > 0 ? `+${count} ${def.name} Count` : ""].filter(Boolean).join(" and ")
    : `${res.count} ${def?.name ?? key}`;
  log(b, "status", `${t.name} ${t.uid === ctx.self.uid ? "gains" : "is inflicted with"} ${what}${timing === "nextTurn" ? " next turn" : ""} (${label})`);
  if (inflictHandlerDepth === 0) {
    inflictHandlerDepth++;
    try {
      fireUnit("onInflictStatus", { b, self: ctx.self, other: t, skill: ctx.skill, use: ctx.use, statusEvent: { key, potency, count }, depth: (ctx.depth ?? 0) + 1 });
    } finally {
      inflictHandlerDepth--;
    }
  }
}

// ---------------------------------------------------------------------------------
// Modifier collection
// ---------------------------------------------------------------------------------
export interface ModPart {
  label: string;
  value: number;
}

function modMatches(m: { sin?: Sin | null; dmgType?: string | null; status?: string; coin?: number }, ctx: Ctx, wantStatus?: string): boolean {
  if (m.sin && ctx.skill?.sin !== m.sin) return false;
  if (m.dmgType && ctx.skill?.dmgType !== m.dmgType) return false;
  if (wantStatus !== undefined && m.status && m.status !== wantStatus) return false;
  if (m.coin && ctx.coin && m.coin !== ctx.coin.index) return false;
  return true;
}

/**
 * Sum every modifier of `stat` that applies to `ctx.self`: temporary modifiers,
 * plus "always" effects from the current skill/coin (if self is the user),
 * passives, E.G.O passives, custom statuses and gifts. Built-in status effects
 * (Damage Up, Fragile ...) are added by the combat code.
 */
export function collectMods(stat: ModStat, ctx: Ctx, wantStatus?: string): ModPart[] {
  const { b, self } = ctx;
  const parts: ModPart[] = [];
  const push = (label: string, value: number) => {
    if (value) parts.push({ label, value });
  };
  for (const m of self.mods) if (m.stat === stat && modMatches(m, ctx, wantStatus)) push(m.label, m.value);
  const own = ctx.use && ctx.use.user.uid === self.uid;
  if (own && ctx.use) for (const m of ctx.use.mods) if (m.stat === stat && modMatches(m, ctx, wantStatus)) push(m.label, m.value);
  if (own && ctx.coin) for (const m of ctx.coin.mods) if (m.stat === stat && modMatches(m, ctx, wantStatus)) push(m.label, m.value);

  const always: EffectSource[] = unitSources(b, self, true).filter((s) => s.effect.trigger === "always");
  if (own && ctx.use) {
    const sk = ctx.use.skill;
    for (const e of sk.effects) if (e.trigger === "always") always.push({ effect: e, label: sk.name, key: "" });
    if (ctx.coin) {
      for (const e of ctx.coin.coin.effects) if (e.trigger === "always") always.push({ effect: e, label: `${sk.name} coin ${ctx.coin.index}`, key: "" });
      for (const e of ctx.coin.coin.typeEffects ?? []) if (e.trigger === "always") always.push({ effect: e, label: `${ctx.coin.coin.typeName ?? "Coin type"} (coin ${ctx.coin.index})`, key: "" });
    }
  }
  for (const src of always) {
    if (!src.effect.actions.some((a) => a.kind === "mod" && a.stat === stat)) continue;
    let ok = true;
    for (const c of src.effect.conditions) {
      if (c.kind === "chance") continue; // chance conditions make no sense for passive modifiers
      if (!checkCondition(c, ctx)) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    for (const a of src.effect.actions) {
      if (a.kind !== "mod" || a.stat !== stat) continue;
      if (a.who !== "self" && a.who !== "allAllies") continue; // passive modifiers describe the owner
      if (!modMatches({ sin: a.sin, dmgType: a.dmgType, status: a.stat === "statusDmgTaken" ? a.status : undefined, coin: a.coin }, ctx, wantStatus)) continue;
      push(src.label, evalValue(a.amount, ctx));
    }
  }
  return parts;
}

export function sumParts(parts: ModPart[]): number {
  return parts.reduce((a, p) => a + p.value, 0);
}

export function describeParts(parts: ModPart[], unitSuffix = ""): string {
  return parts.map((p) => `${p.label} ${p.value >= 0 ? "+" : ""}${fmt(p.value)}${unitSuffix}`).join(", ");
}

/** Typed damage helper used by statuses such as Sinking on non-SP units. */
export function sinTyped(b: BattleState, u: UnitState, n: number, sin: Sin | null): number {
  return Math.floor(n * typedResistFactor(b, u, sin, null) + 1e-9);
}

export const ALL_SINS = SINS;
export { unit };

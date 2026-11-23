// The turn loop: Turn Start -> planning -> Combat Start -> resolution -> Turn End.
import { LIMITS, SINS, type Sin } from "./constants";
import { absoluteResonanceBonus, headsChance, overclockCost, resonanceBonus } from "./formulas";
import * as R from "./rng";
import {
  addStatus, bodies, canAct, clampSp, cleanupStatus, core, getStatus, log, newActionId, opposite, reduceStatus,
  sideUnits, stat, statusDef, statusValue, targetables, unit,
} from "./state";
import type { BattleState, CSkill, PlannedAction, Side, UnitState } from "./types";
import { collectMods, fireSkill, fireTeam, fireUnit, passiveRequirementMet, sumParts, type SkillUse } from "./effects";
import {
  changeSp, clashAndAttack, dealFixedDamage, newUse, onUse, readiedFor, runAttack, setReadied, type Readied,
} from "./combat";
import { clashOdds, expectedPower as meanPower, powerDist, staticCoins, type ClashSide } from "./odds";
import { spawnWave } from "./setup";
import { corrosionChance } from "./constants";

// ---------------------------------------------------------------------------------
// Turn Start
// ---------------------------------------------------------------------------------
export function startTurn(b: BattleState) {
  b.turn += 1;
  b.egoUsed = [];
  b.resonance = Object.fromEntries(SINS.map((s) => [s, 0])) as Record<Sin, number>;
  b.aResonance = Object.fromEntries(SINS.map((s) => [s, false])) as Record<Sin, boolean>;
  log(b, "turn", `— Turn ${b.turn} —`, undefined, { important: true });

  // next wave
  if (!bodies(b, "enemy").length && b.waveIndex + 1 < b.waves.length) spawnWave(b, null, b.waveIndex + 1);

  for (const u of b.units) {
    if (!u.alive) continue;
    u.shield = 0;
    u.limits = {};
    u.turn = { hpLost: 0, spLost: 0, damageDealt: 0, acted: false };
    // statuses and modifiers inflicted "next turn"
    for (const p of u.pending) addStatus(b, u, p.key, p.potency, p.count, "now");
    u.pending = [];
    u.mods = u.pendingMods;
    u.pendingMods = [];
    u.egoPassives = Array.from(new Set([...u.egoPassives, ...u.egoPassivesPending]));
    u.egoPassivesPending = [];
    // indestructible parts recover
    if (u.kind === "part" && u.breakable === "indestructible" && u.hp <= 0) u.hp = u.maxHp;
    // Sanity: Panic & Low Morale take effect at Turn Start
    if (u.hasSanity) {
      if (u.panic === "panic" && u.panicTurn < b.turn) {
        if (u.side === "ally" || u.panicRecovery) {
          u.sp = 0;
          log(b, "sp", `${u.name} recovers from Panic (SP reset to 0).`);
        } else u.panicLocked = true; // enemies stay at -45 SP but only Panic once
        u.panic = "none";
      }
      if (u.sp > LIMITS.sp.min) u.panicLocked = false;
      if (u.panic !== "panic") {
        if (u.sp <= LIMITS.sp.min && !u.panicLocked) {
          u.panic = "panic";
          u.panicTurn = b.turn;
          log(b, "sp", `${u.name} Panics and cannot act this turn!`, undefined, { important: true, side: u.side });
        } else if (u.sp <= -30 && R.chance(b.rng, b.settings.lowMoraleChance)) {
          u.panic = "lowMorale";
          log(b, "sp", `${u.name} is at Low Morale.`, undefined, { side: u.side });
        } else u.panic = "none";
      }
    }
  }
  rollSpeeds(b);
  // Passives with no requirement (or an "owned" requirement) are active from Turn Start
  for (const u of b.units) {
    if (!u.alive) continue;
    u.activePassives = u.passives.filter((k) => {
      const p = b.content.passives[k];
      return p && (p.reqMode === "none" || (p.reqMode === "owned" && passiveRequirementMet(b, k, u.side)));
    });
  }
  for (const u of b.units) if (u.alive) {
    // Nails: gain 1 Bleed and +Count Bleed Count
    const nails = getStatus(u, "NAILS");
    if (nails) addStatus(b, u, "BLEED", 1, nails.count, "now");
    fireUnit("turnStart", { b, self: u });
  }
  fireTeam("turnStart", b);
  assignSlots(b);
  b.plan = [];
  planEnemies(b);
  planAlliesDefault(b);
  b.phase = "planning";
}

function rollSpeeds(b: BattleState) {
  for (const u of b.units) {
    if (!u.alive || u.kind === "core") continue;
    let s = R.int(b.rng, u.speedMin, u.speedMax);
    s += statusValue(b, u, "HASTE") - statusValue(b, u, "BIND");
    s += sumParts(collectMods("speed", { b, self: u }));
    u.speed = Math.max(1, s);
  }
}

function assignSlots(b: BattleState) {
  const allies = b.units.filter((u) => u.side === "ally" && u.alive && u.deployOrder >= 0).sort((x, y) => x.deployOrder - y.deployOrder);
  const cap = b.settings.focused ? b.maxDeploy : 12;
  for (const a of allies) a.slots = 1;
  let extra = Math.max(0, Math.min(cap - allies.length, b.turn - 1));
  // extra slots go round-robin in Deployment Order
  let i = 0;
  while (extra > 0 && allies.length) {
    allies[i % allies.length].slots += 1;
    i++;
    extra--;
  }
  for (const e of b.units) {
    if (e.side !== "enemy" || !e.alive || e.kind === "core") continue;
    // enemies gain 1 Skill Slot per turn up to their maximum
    e.slots = e.kind === "part" ? e.slotsMax : Math.min(e.slotsMax, e.slots + (b.turn > 1 ? 1 : 0));
  }
  if (b.settings.skillMode === "deck") for (const a of allies) ensureHand(b, a);
}

// ---------------------------------------------------------------------------------
// Skill deck ("List of Upcoming Skills": 3x S1, 2x S2, 1x S3 by default)
// ---------------------------------------------------------------------------------
function refillList(b: BattleState, u: UnitState): string[] {
  const list: string[] = [];
  for (const k of u.attackSkills) {
    const s = b.content.skills[k];
    const n = s?.amount ?? 1;
    for (let i = 0; i < n; i++) list.push(k);
  }
  return R.shuffle(b.rng, list);
}

function draw(b: BattleState, u: UnitState): string | null {
  if (!u.deck) u.deck = { list: [], hand: [] };
  if (!u.deck.list.length) u.deck.list = refillList(b, u);
  return u.deck.list.shift() ?? u.attackSkills[0] ?? null;
}

function ensureHand(b: BattleState, u: UnitState) {
  if (!u.deck) u.deck = { list: [], hand: [] };
  while (u.deck.hand.length < u.slots) u.deck.hand.push([]);
  u.deck.hand.length = u.slots;
  for (const h of u.deck.hand) while (h.length < 2) {
    const k = draw(b, u);
    if (!k) break;
    h.push(k);
  }
}

/** Skills an ally slot may pick this turn. */
export function skillOptions(b: BattleState, action: PlannedAction): string[] {
  const u = unit(b, action.uid);
  if (!u) return [];
  const atk = b.settings.skillMode === "deck" && u.deck ? u.deck.hand[action.slot] ?? [] : u.attackSkills;
  return Array.from(new Set([...atk, ...u.defenseSkills]));
}

export function egoOptions(b: BattleState, action: PlannedAction): { key: string; affordable: boolean; overclockAffordable: boolean; usedThisTurn: boolean }[] {
  const u = unit(b, action.uid);
  if (!u) return [];
  return u.egos.map((key) => {
    const ego = b.content.egos[key];
    const res = b.resources.ally;
    const already = b.plan.some((a) => a.id !== action.id && a.ego?.key === key);
    const costOk = (mult: (n: number) => number) => SINS.every((s) => (res[s] ?? 0) >= mult(ego.cost[s] ?? 0));
    return { key, affordable: costOk((n) => n), overclockAffordable: !!ego.corrosion && costOk(overclockCost), usedThisTurn: already };
  });
}

// ---------------------------------------------------------------------------------
// Planning: enemies (AI) and allies (defaults / auto)
// ---------------------------------------------------------------------------------
function planEnemies(b: BattleState) {
  const enemyUnits = b.units.filter((u) => u.side === "enemy" && u.alive && u.kind !== "core");
  for (const e of enemyUnits) {
    if (!canAct(b, e)) continue;
    let picks: string[] = [];
    if (e.pattern === "rotation" && e.rotation.length) {
      picks = e.rotation[e.rotationIndex % e.rotation.length] ?? [];
      e.rotationIndex++;
    }
    const pool = [...e.attackSkills, ...e.defenseSkills];
    for (let s = 0; s < e.slots; s++) {
      const key = picks[s] ?? R.pick(b.rng, pool) ?? null;
      b.plan.push({ id: newActionId(b), uid: e.uid, side: "enemy", slot: s, skill: key, target: null, targetAction: null });
    }
  }
  // Targeting: faster enemy slots aim at slower ally slots first (Regular Encounters).
  const allySlots: { uid: string; slot: number; speed: number }[] = [];
  for (const a of b.units) if (a.side === "ally" && a.alive && a.deployOrder >= 0 && a.targetable) for (let s = 0; s < a.slots; s++) allySlots.push({ uid: a.uid, slot: s, speed: a.speed });
  allySlots.sort((x, y) => x.speed - y.speed);
  const enemyActions = b.plan.filter((a) => a.side === "enemy").sort((x, y) => (unit(b, y.uid)?.speed ?? 0) - (unit(b, x.uid)?.speed ?? 0));
  let i = 0;
  for (const a of enemyActions) {
    const skill = a.skill ? b.content.skills[a.skill] : undefined;
    if (!skill || skill.kind === "guard" || skill.kind === "evade") continue;
    if (!allySlots.length) break;
    if (skill.indiscriminate) {
      const any = R.pick(b.rng, b.units.filter((u) => u.alive && u.targetable && u.uid !== a.uid));
      a.target = any?.uid ?? null;
      continue;
    }
    const t = allySlots[i % allySlots.length];
    i++;
    a.target = t.uid;
    a.targetAction = `slot:${t.uid}:${t.slot}`; // resolved to an action id once allies are planned
  }
}

function planAlliesDefault(b: BattleState) {
  const allies = b.units.filter((u) => u.side === "ally" && u.alive && u.deployOrder >= 0).sort((x, y) => y.speed - x.speed);
  for (const u of allies) {
    for (let s = 0; s < u.slots; s++) {
      b.plan.push({ id: newActionId(b), uid: u.uid, side: "ally", slot: s, skill: null, target: null, targetAction: null });
    }
  }
  // resolve enemy "slot:" targets into action ids
  for (const a of b.plan) {
    if (a.side !== "enemy" || !a.targetAction?.startsWith("slot:")) continue;
    const [, uid, slot] = a.targetAction.split(":");
    const target = b.plan.find((x) => x.uid === uid && x.slot === Number(slot));
    a.targetAction = target?.id ?? null;
  }
  autoPlan(b, { onlyEmpty: true, useEgo: false });
}

export interface AutoOptions {
  onlyEmpty?: boolean;
  useEgo?: boolean;
}

/** Fill ally actions: clash the enemy attacking you with your best skill, otherwise hit the weakest enemy. */
export function autoPlan(b: BattleState, opts: AutoOptions = {}) {
  const allyActions = b.plan.filter((a) => a.side === "ally").sort((x, y) => (unit(b, y.uid)?.speed ?? 0) - (unit(b, x.uid)?.speed ?? 0));
  const taken = new Set<string>();
  for (const a of allyActions) if (opts.onlyEmpty && a.skill && a.targetAction) taken.add(a.targetAction);
  for (const a of allyActions) {
    const u = unit(b, a.uid);
    if (!u || !canAct(b, u)) continue;
    if (opts.onlyEmpty && a.skill) continue;
    const options = skillOptions(b, a).filter((k) => b.content.skills[k]?.kind === "attack");
    if (!options.length) continue;
    // enemy actions aimed at this unit (prefer the one aimed at this slot)
    const incoming = b.plan
      .filter((e) => e.side === "enemy" && !taken.has(e.id) && e.target === u.uid && e.skill && b.content.skills[e.skill]?.kind !== "guard" && b.content.skills[e.skill]?.kind !== "evade" && !b.content.skills[e.skill]?.unclashable)
      .sort((x, y) => Number(y.targetAction === a.id) - Number(x.targetAction === a.id));
    const vs = incoming[0];
    let best = options[0];
    let bestScore = -Infinity;
    for (const k of options) {
      const s = b.content.skills[k];
      const score = vs ? estimateClash(b, u, s, vs).win * 100 + expectedPower(b, u, s) * 0.01 : expectedPower(b, u, s);
      if (score > bestScore) {
        bestScore = score;
        best = k;
      }
    }
    a.skill = best;
    if (vs) {
      a.target = vs.uid;
      a.targetAction = vs.id;
      taken.add(vs.id);
    } else {
      const enemies = targetables(b, "enemy");
      const weakest = [...enemies].sort((x, y) => core(b, x).hp - core(b, y).hp)[0];
      a.target = weakest?.uid ?? null;
      const theirs = b.plan.find((e) => e.uid === weakest?.uid && !taken.has(e.id) && (unit(b, e.uid)?.speed ?? 99) < u.speed && e.skill && b.content.skills[e.skill]?.kind === "attack");
      a.targetAction = theirs?.id ?? null;
      if (theirs) taken.add(theirs.id);
    }
    if (opts.useEgo && a.slot === 0) maybeUseEgo(b, a, u);
  }
}

function maybeUseEgo(b: BattleState, a: PlannedAction, u: UnitState) {
  const opts = egoOptions(b, a).filter((o) => o.affordable && !o.usedThisTurn);
  for (const o of opts.reverse()) {
    const ego = b.content.egos[o.key];
    if (u.sp - ego.spCost < 0) continue;
    a.ego = { key: o.key, overclock: false };
    a.skill = ego.awakening;
    return;
  }
}

function expectedPower(b: BattleState, u: UnitState, s: CSkill): number {
  const coins = staticCoins(s, headsChance(u.sp, u.hasSanity), b.content.coinTypes ?? {});
  return meanPower(powerDist(s.basePower, coins)) * Math.max(1, s.coins.length);
}

function sideFor(b: BattleState, u: UnitState, s: CSkill, bonus: number): ClashSide {
  return {
    base: s.basePower + statusValue(b, u, "BASE_POWER_UP"),
    coins: staticCoins(s, headsChance(u.sp, u.hasSanity), b.content.coinTypes ?? {}),
    bonus: bonus + statusValue(b, u, "CLASH_POWER_UP") - statusValue(b, u, "CLASH_POWER_DOWN"),
    finalBonus: statusValue(b, u, "POWER_UP") - statusValue(b, u, "POWER_DOWN") + (s.kind === "attack" ? statusValue(b, u, "ATTACK_POWER_UP") - statusValue(b, u, "ATTACK_POWER_DOWN") : 0),
  };
}

/** Quick Clash forecast between an ally skill and an enemy planned action (ignores conditional effects). */
export function estimateClash(b: BattleState, u: UnitState, s: CSkill, enemyAction: PlannedAction) {
  const e = unit(b, enemyAction.uid);
  const es = enemyAction.skill ? b.content.skills[enemyAction.skill] : undefined;
  if (!e || !es) return { win: 1, lose: 0 };
  const lvl = (x: UnitState, sk: CSkill) => x.level + sk.levelMod;
  const d = lvl(u, s) - lvl(e, es);
  const ab = d > 0 ? Math.floor(d / 3) : 0;
  const eb = d < 0 ? Math.floor(-d / 3) : 0;
  return clashOdds(sideFor(b, u, s, ab), sideFor(b, e, es, eb));
}

export interface Forecast {
  mode: "clash" | "oneSided" | "defense" | "none";
  vs?: PlannedAction;
  win?: number;
  note?: string;
}

/** What will happen with this ally action, with the current plan. */
export function forecast(b: BattleState, action: PlannedAction): Forecast {
  const u = unit(b, action.uid);
  const s = action.skill ? b.content.skills[action.skill] : undefined;
  if (!u || !s) return { mode: "none" };
  if (s.kind !== "attack" && !(s.clashable && action.targetAction)) return { mode: "defense", note: s.kind === "guard" ? "Guards when attacked" : s.kind === "evade" ? "Evades incoming coins" : "Counters after being attacked" };
  const pair = pairing(b).get(action.id);
  if (pair) {
    const vs = b.plan.find((x) => x.id === pair);
    if (vs) return { mode: "clash", vs, win: estimateClash(b, u, s, vs).win };
  }
  return { mode: "oneSided", note: action.targetAction ? "Too slow to redirect: attacks one-sided" : undefined };
}

/**
 * Decide which actions Clash. An ally action aimed at an enemy action clashes when
 * that enemy action targets this ally, or when the ally is faster (redirect).
 */
export function pairing(b: BattleState): Map<string, string> {
  const map = new Map<string, string>();
  const used = new Set<string>();
  const acts = [...b.plan].sort((x, y) => (unit(b, y.uid)?.speed ?? 0) - (unit(b, x.uid)?.speed ?? 0));
  for (const a of acts) {
    if (a.side !== "ally" || !a.skill || !a.targetAction || used.has(a.id)) continue;
    const s = b.content.skills[a.skill];
    if (!s || (s.kind !== "attack" && !s.clashable) || s.kind === "evade") continue;
    const e = b.plan.find((x) => x.id === a.targetAction);
    if (!e || used.has(e.id) || !e.skill) continue;
    const es = b.content.skills[e.skill];
    if (!es || es.unclashable || s.unclashable) continue;
    if (es.kind !== "attack" && !es.clashable) continue;
    if (s.kind !== "attack" && es.kind !== "attack") continue;
    const au = unit(b, a.uid);
    const eu = unit(b, e.uid);
    if (!au || !eu) continue;
    const aimedAtMe = e.target === a.uid;
    const faster = au.speed > eu.speed;
    if (!aimedAtMe && !faster && !(b.settings.focused && e.target === au.uid)) continue;
    map.set(a.id, e.id);
    map.set(e.id, a.id);
    used.add(a.id);
    used.add(e.id);
  }
  return map;
}

// ---------------------------------------------------------------------------------
// Combat Start and resolution
// ---------------------------------------------------------------------------------
function computeResonance(b: BattleState) {
  const chain = b.plan
    .filter((a) => a.side === "ally" && a.skill)
    .sort((x, y) => (unit(b, y.uid)?.speed ?? 0) - (unit(b, x.uid)?.speed ?? 0) || (unit(b, x.uid)?.deployOrder ?? 0) - (unit(b, y.uid)?.deployOrder ?? 0));
  const sins = chain.map((a) => b.content.skills[a.skill!]?.sin ?? null);
  const position: Record<string, number> = {};
  sins.forEach((s, i) => {
    if (!s) return;
    position[s] = (position[s] ?? 0) + 1;
    chain[i].resonance = resonanceBonus(position[s]);
    chain[i].aRes = false;
  });
  for (const s of SINS) b.resonance[s] = position[s] ?? 0;
  // Absolute Resonance: 3+ adjacent skills of the same sin
  let i = 0;
  while (i < sins.length) {
    const s = sins[i];
    let j = i;
    while (j + 1 < sins.length && sins[j + 1] === s) j++;
    const len = j - i + 1;
    if (s && len >= 3) {
      b.aResonance[s] = true;
      const bonus = absoluteResonanceBonus(len);
      for (let k = i; k <= j; k++) {
        if (bonus > (chain[k].resonance ?? 0)) chain[k].resonance = bonus;
        chain[k].aRes = true;
      }
    }
    i = j + 1;
  }
  // single skills are not "Resonance"
  for (const a of chain) {
    const s = b.content.skills[a.skill!]?.sin;
    if (s && (position[s] ?? 0) < 2) a.resonance = 0;
  }
}

function payEgo(b: BattleState) {
  for (const a of b.plan) {
    if (a.side !== "ally" || !a.ego) continue;
    const ego = b.content.egos[a.ego.key];
    if (!ego || b.egoUsed.includes(ego.key)) {
      a.ego = null;
      continue;
    }
    const mult = a.ego.overclock ? overclockCost : (n: number) => n;
    const res = b.resources.ally;
    const ok = SINS.every((s) => res[s] >= mult(ego.cost[s] ?? 0));
    if (!ok && !a.ego.overclock) {
      log(b, "warn", `Not enough E.G.O resources for ${ego.name}; using a normal skill instead.`);
      a.ego = null;
      a.skill = unit(b, a.uid)?.attackSkills[0] ?? null;
      continue;
    }
    for (const s of SINS) res[s] -= mult(ego.cost[s] ?? 0); // Unstable Overclock may go negative
    b.egoUsed.push(ego.key);
    a.skill = a.ego.overclock && ego.corrosion ? ego.corrosion : ego.awakening;
  }
}

/** Run the whole turn with the current plan, then start the next turn (unless the battle ended). */
export function resolveTurn(b: BattleState) {
  if (b.phase === "ended") return;
  resolveCombat(b);
  endTurn(b);
}

/** Combat Start + every action of the turn (no Turn End). */
export function resolveCombat(b: BattleState) {
  payEgo(b);
  computeResonance(b);
  for (const u of b.units) {
    if (!u.alive) continue;
    u.activePassives = u.passives.filter((k) => passiveRequirementMet(b, k, u.side));
  }
  const pairs = pairing(b);
  for (const a of b.plan) {
    a.clashWith = pairs.get(a.id) ?? null;
    if (a.clashWith) {
      const partner = b.plan.find((x) => x.id === a.clashWith);
      if (partner) partner.target = a.uid;
    }
  }
  // Readied defense skills
  const ready: Readied[] = [];
  for (const a of b.plan) {
    const s = a.skill ? b.content.skills[a.skill] : undefined;
    if (!s || s.kind === "attack") continue;
    if (a.clashWith) continue; // a clashable defense used in a planned clash
    ready.push({ actionId: a.id, uid: a.uid, skill: s, used: false, failed: false });
  }
  setReadied(b, ready);

  log(b, "info", resonanceSummary(b));
  for (const u of b.units) if (u.alive) fireUnit("combatStart", { b, self: u });
  fireTeam("combatStart", b);
  for (const a of b.plan) {
    const u = unit(b, a.uid);
    const s = a.skill ? b.content.skills[a.skill] : undefined;
    if (!u || !s) continue;
    fireSkill("combatStart", { b, self: u, skill: s, use: newUse(b, a, u, s, unit(b, a.target) ?? u) });
  }

  const order = [...b.plan].sort((x, y) => {
    const ux = unit(b, x.uid), uy = unit(b, y.uid);
    return (uy?.speed ?? 0) - (ux?.speed ?? 0) || (x.side === "ally" ? -1 : 1) - (y.side === "ally" ? -1 : 1) || (ux?.deployOrder ?? 0) - (uy?.deployOrder ?? 0);
  });
  for (const a of order) {
    if (b.outcome) break;
    if (a.done) continue;
    resolveAction(b, a);
    checkOutcome(b, false);
  }
}

function resonanceSummary(b: BattleState): string {
  const parts = SINS.filter((s) => b.resonance[s] >= 2).map((s) => `${s[0]}${s.slice(1).toLowerCase()} ×${b.resonance[s]}${b.aResonance[s] ? " (Absolute)" : ""}`);
  return parts.length ? `Sin Resonance: ${parts.join(", ")}` : "No Sin Resonance this turn.";
}

function resolveTarget(b: BattleState, u: UnitState, a: PlannedAction, s: CSkill): UnitState | undefined {
  let t = unit(b, a.target);
  if (t && t.alive && t.targetable && (t.side !== u.side || s.indiscriminate)) return t;
  const pool = s.indiscriminate ? b.units.filter((x) => x.alive && x.targetable && x.uid !== u.uid) : targetables(b, opposite(u.side));
  t = R.pick(b.rng, pool);
  return t;
}

function prepareEgoUse(b: BattleState, u: UnitState, a: PlannedAction, s: CSkill): CSkill {
  if (!a.ego) return s;
  const ego = b.content.egos[a.ego.key];
  if (!ego) return s;
  const cost = a.ego.overclock ? overclockCost(ego.spCost) : ego.spCost;
  const spAfter = clampSp(u.sp - cost);
  changeSp(b, u, -cost, `${ego.name} SP cost`);
  u.sinResist = { ...ego.sinResist };
  if (ego.passive && !u.egoPassives.includes(ego.passive)) u.egoPassivesPending.push(ego.passive);
  if (!a.ego.overclock && ego.corrosion && R.chance(b.rng, corrosionChance(spAfter))) {
    log(b, "warn", `${u.name}'s ${ego.name} Corrodes!`, undefined, { important: true, side: u.side });
    return b.content.skills[ego.corrosion];
  }
  return s;
}

function resolveAction(b: BattleState, a: PlannedAction) {
  a.done = true;
  const u = unit(b, a.uid);
  if (!u || !u.alive) return;
  if (!canAct(b, u)) {
    if (u.alive && a.skill) log(b, "info", `${u.name} cannot act (${core(b, u).stagger ? "Staggered" : u.panic === "panic" ? "Panicking" : "unable"}).`);
    return;
  }
  let s = a.skill ? b.content.skills[a.skill] : undefined;
  if (!s) return;
  if (s.kind !== "attack" && !a.clashWith) return; // readied defense skill
  u.turn.acted = true;
  s = prepareEgoUse(b, u, a, s);
  const target = resolveTarget(b, u, a, s);
  if (!target) return;
  const use = newUse(b, a, u, s, target);
  use.isEgo = !!a.ego;

  // planned Clash
  if (a.clashWith) {
    const p = b.plan.find((x) => x.id === a.clashWith);
    const pu = p ? unit(b, p.uid) : undefined;
    const ps = p?.skill ? b.content.skills[p.skill] : undefined;
    if (p && !p.done && pu && ps && canAct(b, pu) && pu.alive) {
      p.done = true;
      let partnerSkill = ps;
      partnerSkill = prepareEgoUse(b, pu, p, partnerSkill);
      const pUse = newUse(b, p, pu, partnerSkill, u);
      pUse.isEgo = !!p.ego;
      log(b, "clash", `${u.name} (${s.name}, Speed ${u.speed}) clashes with ${pu.name} (${partnerSkill.name}, Speed ${pu.speed}).`, undefined, { side: u.side });
      clashAndAttack(b, use, pUse);
      return;
    }
    if (s.kind !== "attack") return;
  }

  // reflexive Clashable Counter / Guard on the target
  if (!s.unclashable) {
    const reflex = reflexDefense(b, target);
    if (reflex) {
      reflex.used = true;
      const dUse = newUse(b, { id: reflex.actionId, uid: target.uid, side: target.side, slot: 0, skill: reflex.skill.key, target: u.uid, targetAction: null, resonance: 0 }, target, reflex.skill, u);
      log(b, "clash", `${target.name} meets ${u.name}'s ${s.name} with ${reflex.skill.name}.`, undefined, { side: target.side });
      clashAndAttack(b, use, dUse);
      return;
    }
  }
  log(b, "attack", `${u.name} uses ${s.name} on ${target.name} (one-sided).`, undefined, { side: u.side });
  onUse(b, use);
  runAttack(b, use, null);
}

function reflexDefense(b: BattleState, t: UnitState): Readied | undefined {
  if (!canAct(b, t)) return undefined;
  const all = readiedFor(b, t).filter((r) => r.skill.clashable);
  return all.find((r) => r.skill.kind === "counter") ?? all.find((r) => r.skill.kind === "guard");
}

// ---------------------------------------------------------------------------------
// Turn End
// ---------------------------------------------------------------------------------
export function endTurn(b: BattleState, startNext = true) {
  for (const u of b.units) if (u.alive) fireUnit("turnEnd", { b, self: u });
  fireTeam("turnEnd", b);
  for (const a of b.plan) {
    const u = unit(b, a.uid);
    const s = a.skill ? b.content.skills[a.skill] : undefined;
    if (!u || !s || !u.alive) continue;
    const use: SkillUse = newUse(b, a, u, s, unit(b, a.target) ?? u);
    fireSkill("turnEnd", { b, self: u, skill: s, use });
  }
  // Burn and Poison
  for (const u of b.units) {
    if (!u.alive) continue;
    const burn = getStatus(u, "BURN");
    if (burn) {
      const n = burn.potency;
      reduceStatus(b, u, "BURN", "count", 1);
      dealFixedDamage(b, u, n, { label: "Burn", canStagger: true, status: "BURN" });
    }
    const poison = getStatus(u, "POISON");
    if (poison && u.alive) {
      const n = poison.count;
      poison.count = Math.floor(poison.count / 2);
      cleanupStatus(b, u, poison);
      dealFixedDamage(b, u, n, { label: "Poison", canStagger: true, status: "POISON" });
    }
  }
  // Decay
  for (const u of b.units) {
    if (!u.alive) continue;
    for (const s of [...u.statuses]) {
      const def = statusDef(b, s.key);
      if (!def) continue;
      if (def.oneTurn) {
        u.statuses = u.statuses.filter((x) => x !== s);
        continue;
      }
      if (s.key === "POISE" || s.key === "CHARGE" || s.key === "TREMOR") s.count -= 1;
      if (s.key === "TREMOR" && s.entangled) {
        s.tremorTypes = [];
        s.entangled = false;
      }
      if (s.key === "NAILS") s.count = Math.floor(s.count / 2);
      const custom = b.content.statuses[s.key];
      if (custom) {
        if (custom.turnEnd === "countMinus1") s.count -= 1;
        else if (custom.turnEnd === "potencyMinus1") s.potency -= 1;
        else if (custom.turnEnd === "halve") s.count = Math.floor(s.count / 2);
      }
      cleanupStatus(b, u, s);
    }
    // Stagger lasts the turn it happens and the whole next turn
    if (u.stagger > 0 && u.staggerTurn < b.turn) {
      u.stagger = 0;
      log(b, "stagger", `${u.name} recovers from Stagger.`);
    }
    u.mods = [];
  }
  // Deck: used skills leave the hand
  if (b.settings.skillMode === "deck") {
    for (const a of b.plan) {
      const u = unit(b, a.uid);
      if (!u?.deck || a.side !== "ally" || !a.skill || a.ego) continue;
      const hand = u.deck.hand[a.slot];
      const i = hand?.indexOf(a.skill) ?? -1;
      if (i >= 0) hand.splice(i, 1);
    }
  }
  for (const u of b.units) if (u.alive) stat(b, u).hpEnd = core(b, u).hp;
  checkOutcome(b, true);
  if (b.outcome) b.phase = "ended";
  else if (startNext) startTurn(b);
}

export function checkOutcome(b: BattleState, endOfTurn: boolean) {
  if (b.outcome) return;
  const allies = b.units.filter((u) => u.side === "ally" && u.alive && u.deployOrder >= 0);
  const enemies = bodies(b, "enemy");
  if (!allies.length) finish(b, "loss", "All deployed Identities were defeated.");
  else if (!enemies.length && b.waveIndex + 1 >= b.waves.length) finish(b, "win", "All enemies were defeated!");
  else if (endOfTurn && b.turnLimit > 0 && b.turn >= b.turnLimit) finish(b, "loss", `Turn limit (${b.turnLimit}) reached.`);
  else if (endOfTurn && b.turn >= LIMITS.turnsMax) finish(b, "loss", "Turn 99 reached (OverClock).");
}

function finish(b: BattleState, outcome: "win" | "loss", why: string) {
  b.outcome = outcome;
  b.phase = "ended";
  for (const u of b.units) {
    const s = b.stats[u.uid];
    if (s) {
      s.hpEnd = Math.max(0, core(b, u).hp);
      s.alive = u.alive;
    }
  }
  log(b, "result", `${outcome === "win" ? "Victory" : "Defeat"} on turn ${b.turn}. ${why}`, undefined, { important: true });
}

/** Auto-play until the battle ends (or `maxTurns`). */
export function runToEnd(b: BattleState, maxTurns = 60, useEgo = true) {
  let guard = 0;
  while (!b.outcome && guard++ < maxTurns) {
    autoPlan(b, { onlyEmpty: false, useEgo });
    resolveTurn(b);
  }
  if (!b.outcome) finish(b, "loss", `Stopped after ${maxTurns} turns.`);
}

export function setAction(b: BattleState, id: string, patch: Partial<PlannedAction>) {
  const a = b.plan.find((x) => x.id === id);
  if (a) Object.assign(a, patch);
}

export function sideOf(b: BattleState, uid: string): Side | undefined {
  return unit(b, uid)?.side;
}

export { sideUnits };

// Calculator harness: one attacker vs one defender, one exchange (a Clash or a
// one-sided attack). Runs the real engine many times for odds, plus forced
// "best/worst case" runs that show the exact per-coin damage math.
import { SINS, type EgoGrade, type Sin } from "./constants";
import * as R from "./rng";
import type { Team, Workspace } from "../data/schema";
import type { BattleState, BattleSettings, LogEntry, PlannedAction, UnitState } from "./types";
import { compileStatus, enemyUnits, giftEffects, identityUnit, zeroSins } from "./setup";
import { endTurn, resolveCombat } from "./turn";
import type { HitRecord } from "./combat";
import { core, stat } from "./state";
import { BUILTIN_STATUSES } from "./statuses";

export interface Combatant {
  kind: "identity" | "enemy";
  id: string;
  level: number; // 0 = authored level
  uptie: number;
  egos: Partial<Record<EgoGrade, string | null>>;
  sp: number;
  hpPct: number;
  stagger: number;
  speed: number;
  statuses: { key: string; potency: number; count: number }[];
  /** Skill reference: "S1".."S3", "D0".., "K<n>" (enemy skill), "E:<GRADE>:A|C" (E.G.O), or "" for none. */
  skill: string;
  part: number; // which part of a multi-part enemy acts / is targeted
  resonance: number;
}

export interface CalcInput {
  workspace: Workspace;
  attacker: Combatant;
  defender: Combatant;
  exchange: "clash" | "oneSided";
  turnEnd: boolean;
  runs: number;
  seed: number;
  gifts: { giftId: string; level: number }[];
  /** Treat Resonance / Owned passive requirements as met (default true). */
  assumePassives?: boolean;
}

export interface Distribution {
  mean: number;
  min: number;
  max: number;
  p10: number;
  p50: number;
  p90: number;
  hist: { value: number; prob: number }[];
}

export interface Scenario {
  name: string;
  description: string;
  hits: HitRecord[];
  log: LogEntry[];
  defenderDamage: number;
  attackerDamage: number;
  winner: "attacker" | "defender" | "none";
}

export interface CalcResult {
  runs: number;
  attackerWin: number;
  defenderWin: number;
  cancelled: number;
  avgClashRounds: number;
  damageToDefender: Distribution;
  damageToAttacker: Distribution;
  defenderKilled: number;
  defenderStaggered: number;
  attackerKilled: number;
  scenarios: Scenario[];
  sample: LogEntry[];
  warnings: string[];
}

function makeUnits(b: BattleState, ws: Workspace, c: Combatant, uid: string, side: "ally" | "enemy", warnings: string[]): UnitState[] {
  if (c.kind === "identity") {
    const idn = ws.identities.find((i) => i.id === c.id);
    if (!idn) {
      warnings.push("Pick an Identity.");
      return [];
    }
    const member: Team["members"][keyof Team["members"]] = {
      identityId: idn.id,
      level: c.level || idn.level,
      uptie: c.uptie || 4,
      egos: { ZAYIN: null, TETH: null, HE: null, WAW: null, ALEPH: null, ...c.egos },
    };
    const u = identityUnit(b.content, ws, idn, member, uid, 0);
    u.side = side;
    return [u];
  }
  const e = ws.enemies.find((x) => x.id === c.id);
  if (!e) {
    warnings.push("Pick an enemy.");
    return [];
  }
  const us = enemyUnits(b.content, e, c.level, uid);
  for (const u of us) u.side = side;
  return us;
}

function skillKey(units: UnitState[], c: Combatant): { unit: UnitState; key: string | null } | null {
  const actor = units.find((u) => u.kind === "part") ? units.filter((u) => u.kind === "part")[Math.min(c.part, units.length - 2)] : units[0];
  if (!actor) return null;
  if (!c.skill) return { unit: actor, key: null };
  const key = c.skill.startsWith("E:") ? `${units[0].uid}:${c.skill}` : `${actor.uid}:${c.skill}`;
  return { unit: actor, key };
}

function applyState(b: BattleState, units: UnitState[], c: Combatant) {
  const body = units[0];
  body.hp = Math.max(1, Math.floor((body.maxHp * Math.max(1, Math.min(100, c.hpPct))) / 100));
  for (const t of body.thresholds) if (body.hp <= t.hp) t.triggered = true;
  if (c.stagger > 0) {
    body.stagger = Math.min(3, c.stagger);
    body.staggerTurn = 1;
    for (const p of units) if (p.coreUid === body.uid) p.stagger = body.stagger;
  }
  for (const u of units) {
    u.sp = u.hasSanity ? Math.max(-45, Math.min(45, c.sp)) : 0;
    u.speed = Math.max(1, c.speed);
  }
  const target = units.find((u) => u.kind === "part") ? units.filter((u) => u.kind === "part")[Math.min(c.part, units.length - 2)] : body;
  for (const s of c.statuses) {
    const def = BUILTIN_STATUSES[s.key] ?? b.content.statuses[s.key];
    if (!def) continue;
    target.statuses.push({ key: s.key, potency: def.mode === "pc" ? Math.max(1, s.potency) : 0, count: Math.max(1, s.count) });
  }
}

/** Build the starting state of one exchange. */
export function buildExchange(input: CalcInput): { base: BattleState; warnings: string[]; attackerUid: string; defenderUid: string } {
  const ws = input.workspace;
  const warnings: string[] = [];
  const settings: BattleSettings = { skillMode: "free", logDetail: "none", lowMoraleChance: 1, focused: true, assumePassives: input.assumePassives ?? true };
  const b: BattleState = {
    version: 1,
    rng: R.makeRng(input.seed),
    seed: input.seed,
    turn: 1,
    phase: "planning",
    units: [],
    resources: { ally: { ...zeroSins(), ...Object.fromEntries(SINS.map((s) => [s, 99])) } as Record<Sin, number>, enemy: zeroSins() },
    content: { skills: {}, passives: {}, egos: {}, statuses: {}, gifts: [] },
    waves: [[]],
    waveIndex: 0,
    enemyTemplates: {},
    maxDeploy: 1,
    turnLimit: 0,
    settings,
    plan: [],
    log: [],
    outcome: null,
    stats: {},
    egoUsed: [],
    resonance: zeroSins(),
    aResonance: Object.fromEntries(SINS.map((s) => [s, false])) as Record<Sin, boolean>,
    nextId: 0,
  };
  for (const cs of ws.statuses) if (!BUILTIN_STATUSES[cs.key]) b.content.statuses[cs.key] = compileStatus(cs);
  for (const tg of input.gifts) {
    const g = ws.gifts.find((x) => x.id === tg.giftId);
    if (g) b.content.gifts.push({ key: g.id, name: g.name, scope: g.scope, effects: giftEffects(g, tg.level) });
  }
  const A = makeUnits(b, ws, input.attacker, "A", "ally", warnings);
  const D = makeUnits(b, ws, input.defender, "D", "enemy", warnings);
  b.units.push(...A, ...D);
  if (!A.length || !D.length) return { base: b, warnings, attackerUid: "", defenderUid: "" };
  applyState(b, A, input.attacker);
  applyState(b, D, input.defender);
  for (const u of b.units) stat(b, u);
  const a = skillKey(A, input.attacker);
  const d = skillKey(D, input.defender);
  if (!a?.key || !b.content.skills[a.key]) warnings.push("The attacker needs a skill.");
  const aAct: PlannedAction = { id: "atk", uid: a!.unit.uid, side: "ally", slot: 0, skill: a?.key && b.content.skills[a.key] ? a.key : null, target: d!.unit.uid, targetAction: null, resonance: input.attacker.resonance };
  const ego = a?.key?.includes(":E:") ? a.key.split(":").slice(0, 3).join(":") : null;
  if (ego && b.content.egos[ego]) aAct.ego = { key: ego, overclock: a!.key!.endsWith(":C") };
  b.plan.push(aAct);
  if (input.exchange === "clash" || (d?.key && b.content.skills[d.key] && b.content.skills[d.key].kind !== "attack")) {
    if (d?.key && b.content.skills[d.key]) {
      const dAct: PlannedAction = { id: "def", uid: d.unit.uid, side: "enemy", slot: 0, skill: d.key, target: a!.unit.uid, targetAction: "atk", resonance: input.defender.resonance };
      const ds = b.content.skills[d.key];
      if (input.exchange === "clash" && (ds.kind === "attack" || ds.clashable)) aAct.targetAction = "def";
      b.plan.push(dAct);
    } else if (input.exchange === "clash") warnings.push("Pick the defender's skill to Clash with, or switch to a one-sided attack.");
  }
  return { base: b, warnings, attackerUid: a!.unit.uid, defenderUid: d!.unit.uid };
}

function clone(b: BattleState): BattleState {
  const { content, ...rest } = b;
  const copy = structuredClone(rest) as Omit<BattleState, "content">;
  return { ...copy, content } as BattleState;
}

function runOnce(base: BattleState, input: CalcInput, seed: number, opts: { log: boolean; hits: boolean; force?: BattleSettings["forceCoins"]; crit?: BattleSettings["forceCrit"] }) {
  const b = clone(base);
  b.rng = R.makeRng(seed);
  b.settings = { ...b.settings, logDetail: opts.log ? "full" : "none", forceCoins: opts.force, forceCrit: opts.crit };
  if (opts.hits) b.hits = [];
  b.metrics = { clashRounds: 0, clashes: 0 };
  resolveCombat(b);
  if (input.turnEnd && !b.outcome) endTurn(b, false);
  return b;
}

function damageTo(base: BattleState, b: BattleState, uid: string): number {
  const before = core(base, base.units.find((u) => u.uid === uid)!).hp;
  const after = core(b, b.units.find((u) => u.uid === uid)!);
  return Math.max(0, before - after.hp); // includes overkill
}

function distribution(values: number[]): Distribution {
  if (!values.length) return { mean: 0, min: 0, max: 0, p10: 0, p50: 0, p90: 0, hist: [] };
  const sorted = [...values].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const hist = [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([value, n]) => ({ value, prob: n / values.length }));
  return { mean: values.reduce((a, v) => a + v, 0) / values.length, min: sorted[0], max: sorted[sorted.length - 1], p10: q(0.1), p50: q(0.5), p90: q(0.9), hist };
}

export function runCalc(input: CalcInput): CalcResult {
  const { base, warnings, attackerUid, defenderUid } = buildExchange(input);
  const empty: CalcResult = {
    runs: 0, attackerWin: 0, defenderWin: 0, cancelled: 0, avgClashRounds: 0,
    damageToDefender: distribution([]), damageToAttacker: distribution([]),
    defenderKilled: 0, defenderStaggered: 0, attackerKilled: 0, scenarios: [], sample: [], warnings,
  };
  if (!attackerUid || !base.plan[0]?.skill) return empty;
  const defCore = (b: BattleState) => core(b, b.units.find((u) => u.uid === defenderUid)!);
  const atkCore = (b: BattleState) => core(b, b.units.find((u) => u.uid === attackerUid)!);
  const runs = Math.max(1, Math.min(100000, input.runs));
  const dmgD: number[] = [];
  const dmgA: number[] = [];
  let aWin = 0, dWin = 0, cancel = 0, rounds = 0, clashes = 0, killed = 0, staggered = 0, aKilled = 0;
  const rng = R.makeRng(input.seed);
  const startStagger = defCore(base).stagger;
  for (let i = 0; i < runs; i++) {
    const b = runOnce(base, input, (R.next(rng) * 4294967296) >>> 0, { log: false, hits: false });
    dmgD.push(damageTo(base, b, defenderUid));
    dmgA.push(damageTo(base, b, attackerUid));
    const sa = b.stats[atkCore(b).uid];
    const sd = b.stats[defCore(b).uid];
    if (b.metrics && b.metrics.clashes) {
      clashes++;
      rounds += b.metrics.clashRounds;
      if ((sa?.clashesWon ?? 0) > 0) aWin++;
      else if ((sd?.clashesWon ?? 0) > 0) dWin++;
    } else if (base.plan[1] && base.plan[0].targetAction) cancel++;
    if (!defCore(b).alive) killed++;
    if (defCore(b).stagger > startStagger) staggered++;
    if (!atkCore(b).alive) aKilled++;
  }
  const scenarios: Scenario[] = [];
  const isClash = !!base.plan[0].targetAction;
  const defs: { name: string; description: string; force: BattleSettings["forceCoins"]; crit: BattleSettings["forceCrit"] }[] = isClash
    ? [
        { name: "Best case", description: "Attacker flips all Heads, defender all Tails, crits whenever possible.", force: { ally: "heads", enemy: "tails" }, crit: "always" },
        { name: "Worst case", description: "Attacker flips all Tails, defender all Heads, no crits.", force: { ally: "tails", enemy: "heads" }, crit: "never" },
        { name: "Both all Heads", description: "Every coin lands Heads on both sides, no crits.", force: { ally: "heads", enemy: "heads" }, crit: "never" },
      ]
    : [
        { name: "All Heads", description: "Every attack coin lands Heads, crits whenever possible.", force: { ally: "heads", enemy: "heads" }, crit: "always" },
        { name: "All Heads, no crit", description: "Every coin lands Heads, no crits.", force: { ally: "heads", enemy: "heads" }, crit: "never" },
        { name: "All Tails", description: "Every coin lands Tails, no crits.", force: { ally: "tails", enemy: "tails" }, crit: "never" },
      ];
  for (const d of defs) {
    const b = runOnce(base, input, input.seed, { log: true, hits: true, force: d.force, crit: d.crit });
    const sa = b.stats[atkCore(b).uid];
    const sd = b.stats[defCore(b).uid];
    scenarios.push({
      name: d.name,
      description: d.description,
      hits: b.hits ?? [],
      log: b.log,
      defenderDamage: damageTo(base, b, defenderUid),
      attackerDamage: damageTo(base, b, attackerUid),
      winner: (sa?.clashesWon ?? 0) > 0 ? "attacker" : (sd?.clashesWon ?? 0) > 0 ? "defender" : "none",
    });
  }
  const sample = runOnce(base, input, input.seed ^ 0x5bd1e995, { log: true, hits: false }).log;
  return {
    runs,
    attackerWin: clashes ? aWin / runs : 0,
    defenderWin: clashes ? dWin / runs : 0,
    cancelled: cancel / runs,
    avgClashRounds: clashes ? rounds / clashes : 0,
    damageToDefender: distribution(dmgD),
    damageToAttacker: distribution(dmgA),
    defenderKilled: killed / runs,
    defenderStaggered: staggered / runs,
    attackerKilled: aKilled / runs,
    scenarios,
    sample,
    warnings,
  };
}

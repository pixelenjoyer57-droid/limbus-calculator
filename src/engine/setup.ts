// Builds a BattleState from saved content (team + encounter or a quick enemy list).
import { SINS, type Sin, type Sinner } from "./constants";
import { hpAtLevel } from "./formulas";
import * as R from "./rng";
import { BUILTIN_STATUSES } from "./statuses";
import type { CustomStatus, Ego, Enemy, Gift, Identity, Passive, Skill, Team, Workspace } from "../data/schema";
import type { BattleContent, BattleSettings, BattleState, CPassive, CSkill, CStatusDef, SkillSlot, UnitState } from "./types";
import { fireTeam, fireUnit } from "./effects";
import { log, stat } from "./state";
import { startTurn } from "./turn";

export interface EnemyPick {
  enemyId: string;
  level: number; // 0 = the enemy's own level
  count: number;
}

export interface BattleSetup {
  workspace: Workspace;
  team: Team;
  encounterId?: string | null;
  enemies?: EnemyPick[]; // used when no encounter is given
  seed?: number;
  settings?: Partial<BattleSettings>;
  startSp?: number | null;
  maxDeploy?: number | null;
}

export const zeroSins = (): Record<Sin, number> => Object.fromEntries(SINS.map((s) => [s, 0])) as Record<Sin, number>;
const oneSins = () => Object.fromEntries(SINS.map((s) => [s, 1])) as Record<Sin, number>;

export function compileStatus(cs: CustomStatus): CStatusDef {
  return {
    key: cs.key,
    name: cs.name || "Custom status",
    polarity: cs.polarity,
    mode: cs.mode,
    maxPotency: cs.maxPotency,
    maxCount: cs.maxCount,
    oneTurn: cs.turnEnd === "expire",
    description: cs.description,
    group: "other",
    countsAs: cs.countsAs ?? undefined,
    custom: true,
    effects: cs.effects,
    turnEnd: cs.turnEnd,
  };
}

function addSkill(content: BattleContent, key: string, s: Skill, slot: SkillSlot, extra: Partial<CSkill> = {}): string {
  content.skills[key] = { ...s, key, slot, ...extra };
  return key;
}

function addPassive(content: BattleContent, key: string, p: Passive, ego = false): string {
  content.passives[key] = { ...p, key, ego } as CPassive;
  return key;
}

function baseUnit(partial: Partial<UnitState> & Pick<UnitState, "uid" | "side" | "name" | "kind" | "sourceId" | "level" | "maxHp">): UnitState {
  return {
    traits: [],
    hp: partial.maxHp,
    shield: 0,
    hasSanity: true,
    sp: 0,
    panicRecovery: false,
    panic: "none",
    panicTurn: 0,
    speedMin: 1,
    speedMax: 1,
    speed: 1,
    defenseMod: 0,
    resist: { SLASH: 1, PIERCE: 1, BLUNT: 1 },
    sinResist: oneSins(),
    thresholds: [],
    stagger: 0,
    staggerTurn: 0,
    statuses: [],
    pending: [],
    mods: [],
    pendingMods: [],
    alive: true,
    targetable: true,
    deployOrder: 0,
    slots: 1,
    slotsMax: 1,
    attackSkills: [],
    defenseSkills: [],
    egos: [],
    passives: [],
    supportPassives: [],
    activePassives: [],
    egoPassives: [],
    egoPassivesPending: [],
    slotWeight: 1,
    rotationIndex: 0,
    pattern: "random",
    rotation: [],
    turn: { hpLost: 0, spLost: 0, damageDealt: 0, acted: false },
    limits: {},
    encLimits: {},
    ...partial,
  } as UnitState;
}

function thresholdsFor(pcts: number[], maxHp: number) {
  return [...pcts].sort((a, b) => b - a).map((p) => ({ pct: p, hp: Math.floor((maxHp * p) / 100), triggered: false }));
}

/** Compile one Identity (+ its E.G.O loadout) into a unit. */
export function identityUnit(
  content: BattleContent,
  ws: Workspace,
  idn: Identity,
  member: Team["members"][Sinner],
  uid: string,
  deployOrder: number,
): UnitState {
  const level = member?.level ?? idn.level;
  const uptie = member?.uptie ?? 4;
  const maxHp = hpAtLevel(idn.hp, idn.hpPerLevel, idn.level, level);
  const attack: string[] = [];
  idn.skills.forEach((s, i) => {
    if (i === 2 && uptie < 3) return; // Skill 3 unlocks at Uptie 3
    attack.push(addSkill(content, `${uid}:S${i + 1}`, s, (["S1", "S2", "S3"][i] ?? "S3") as SkillSlot));
  });
  const defense = idn.defense.map((s, i) => addSkill(content, `${uid}:D${i}`, s, "DEF"));
  const combat: string[] = [];
  const support: string[] = [];
  idn.passives.forEach((p, i) => {
    if (p.kind === "combat" && uptie >= 2) combat.push(addPassive(content, `${uid}:P${i}`, p));
    if (p.kind === "support" && uptie >= 3) support.push(addPassive(content, `${uid}:P${i}`, p));
  });
  const egos: string[] = [];
  let sinResist = oneSins();
  for (const grade of ["ZAYIN", "TETH", "HE", "WAW", "ALEPH"] as const) {
    const egoId = member?.egos?.[grade];
    if (!egoId) continue;
    const ego = ws.egos.find((e) => e.id === egoId);
    if (!ego) continue;
    const key = `${uid}:E:${grade}`;
    egos.push(key);
    compileEgo(content, ego, key);
    if (grade === "ZAYIN") sinResist = { ...ego.sinResist };
  }
  return baseUnit({
    uid,
    side: "ally",
    name: `${idn.name}`,
    kind: "identity",
    sourceId: idn.id,
    sinner: idn.sinner,
    traits: idn.traits,
    level,
    maxHp,
    speedMin: idn.speedMin,
    speedMax: Math.max(idn.speedMin, idn.speedMax),
    defenseMod: idn.defenseMod,
    resist: { ...idn.resist },
    sinResist,
    thresholds: thresholdsFor(idn.staggerThresholds, maxHp),
    attackSkills: attack,
    defenseSkills: defense,
    egos,
    passives: combat,
    supportPassives: support,
    deployOrder,
  });
}

function compileEgo(content: BattleContent, ego: Ego, key: string) {
  const awakening = addSkill(content, `${key}:A`, ego.awakening, "EGO", { egoKey: key });
  const corrosion = ego.corrosion ? addSkill(content, `${key}:C`, ego.corrosion, "EGO", { egoKey: key, corrosion: true }) : null;
  const passive = ego.passive ? addPassive(content, `${key}:P`, ego.passive, true) : null;
  content.egos[key] = {
    key,
    name: ego.name,
    grade: ego.grade,
    cost: { ...ego.cost },
    spCost: ego.spCost,
    sinResist: { ...ego.sinResist },
    awakening,
    corrosion,
    passive,
  };
}

/** Compile an enemy into one unit, or a core + part units for multi-part enemies. */
export function enemyUnits(content: BattleContent, e: Enemy, level: number, uidBase: string): UnitState[] {
  const lvl = level > 0 ? level : e.level;
  const common = {
    side: "enemy" as const,
    sourceId: e.id,
    level: lvl,
    hasSanity: e.hasSanity,
    sp: e.hasSanity ? e.startSp : 0,
    panicRecovery: e.panicRecovery,
    speedMin: e.speedMin,
    speedMax: Math.max(e.speedMin, e.speedMax),
    pattern: e.pattern,
  };
  const passives = e.passives.map((p, i) => addPassive(content, `${uidBase}:P${i}`, p));
  if (!e.parts.length) {
    const atk: string[] = [];
    const def: string[] = [];
    const idMap: Record<string, string> = {};
    e.skills.forEach((s, i) => {
      const k = addSkill(content, `${uidBase}:K${i}`, s, "ENEMY");
      idMap[s.id] = k;
      (s.kind === "attack" ? atk : def).push(k);
    });
    return [
      baseUnit({
        ...common,
        uid: uidBase,
        name: e.name,
        kind: "enemy",
        maxHp: e.hp,
        defenseMod: e.defenseMod,
        resist: { ...e.resist },
        sinResist: { ...e.sinResist },
        thresholds: thresholdsFor(e.staggerThresholds, e.hp),
        attackSkills: atk,
        defenseSkills: def,
        passives,
        slots: e.slots,
        slotsMax: Math.max(e.slots, e.slotsMax),
        rotation: e.rotation.map((turn) => turn.map((sid) => idMap[sid]).filter(Boolean)),
      }),
    ];
  }
  const core = baseUnit({
    ...common,
    uid: uidBase,
    name: e.name,
    kind: "core",
    maxHp: e.hp,
    targetable: false,
    defenseMod: e.defenseMod,
    resist: { ...e.resist },
    sinResist: { ...e.sinResist },
    thresholds: thresholdsFor(e.staggerThresholds, e.hp),
    passives,
    slots: 0,
    slotsMax: 0,
  });
  const parts = e.parts.map((p, pi) => {
    const atk: string[] = [];
    const def: string[] = [];
    p.skills.forEach((s, i) => {
      const k = addSkill(content, `${uidBase}:p${pi}:K${i}`, s, "ENEMY", { part: p.name });
      (s.kind === "attack" ? atk : def).push(k);
    });
    return baseUnit({
      ...common,
      uid: `${uidBase}:p${pi}`,
      name: `${e.name} — ${p.name}`,
      kind: "part",
      coreUid: uidBase,
      maxHp: p.hp,
      defenseMod: p.defenseMod,
      resist: { ...p.resist },
      sinResist: { ...p.sinResist },
      breakable: p.breakable,
      attackSkills: atk,
      defenseSkills: def,
      slots: p.slots,
      slotsMax: p.slots,
      hasSanity: false,
    });
  });
  return [core, ...parts];
}

export function coinTypeMap(ws: Workspace) {
  return Object.fromEntries((ws.coinTypes ?? []).map((t) => [t.key, t]));
}

export function giftEffects(g: Gift, level: number) {
  if (level >= 2 && g.plus2) return g.plus2;
  if (level >= 1 && g.plus1) return g.plus1;
  return g.effects;
}

export function createBattle(setup: BattleSetup): { battle: BattleState; warnings: string[] } {
  const ws = setup.workspace;
  const warnings: string[] = [];
  const content: BattleContent = { skills: {}, passives: {}, egos: {}, statuses: {}, gifts: [], coinTypes: coinTypeMap(ws) };
  for (const cs of ws.statuses) {
    if (BUILTIN_STATUSES[cs.key]) continue;
    content.statuses[cs.key] = compileStatus(cs);
  }
  for (const tg of setup.team.gifts) {
    const g = ws.gifts.find((x) => x.id === tg.giftId);
    if (!g) continue;
    content.gifts.push({ key: g.id, name: g.name + (tg.level ? "+".repeat(tg.level) : ""), scope: g.scope, effects: giftEffects(g, tg.level) });
  }
  const enc = setup.encounterId ? ws.encounters.find((e) => e.id === setup.encounterId) : undefined;
  const maxDeploy = setup.maxDeploy ?? enc?.maxDeploy ?? 6;
  const startSp = setup.startSp ?? enc?.startSp ?? 0;
  const focused = enc ? enc.type !== "normal" && enc.type !== "risky" : false;

  const units: UnitState[] = [];
  let order = 0;
  for (const sinner of setup.team.deploy) {
    const member = setup.team.members[sinner];
    const idn = member?.identityId ? ws.identities.find((i) => i.id === member.identityId) : undefined;
    if (!idn) {
      warnings.push(`${sinner} has no Identity selected and was skipped.`);
      continue;
    }
    if (order >= maxDeploy) {
      warnings.push(`${sinner} was not deployed (this fight allows ${maxDeploy}).`);
      continue;
    }
    const u = identityUnit(content, ws, idn, member, `ally${order}`, order);
    u.sp = startSp;
    units.push(u);
    order++;
  }
  // Benched members provide Support Passives
  let bench = 0;
  for (const [sinner, member] of Object.entries(setup.team.members)) {
    if (!member?.identityId || setup.team.deploy.includes(sinner as Sinner)) continue;
    const idn = ws.identities.find((i) => i.id === member.identityId);
    if (!idn) continue;
    const u = identityUnit(content, ws, idn, member, `bench${bench++}`, -1);
    u.alive = false;
    u.targetable = false;
    u.attackSkills = [];
    u.defenseSkills = [];
    u.passives = [];
    units.push(u);
  }
  if (!units.some((u) => u.side === "ally" && u.deployOrder >= 0)) warnings.push("No Identities are deployed. Pick Identities in the team first.");

  const waves: { enemyId: string; level: number }[][] = [];
  if (enc) {
    for (const w of enc.waves) {
      const list: { enemyId: string; level: number }[] = [];
      for (const e of w.enemies) for (let i = 0; i < e.count; i++) list.push({ enemyId: e.enemyId, level: e.level });
      if (list.length) waves.push(list);
    }
  } else if (setup.enemies) {
    const list: { enemyId: string; level: number }[] = [];
    for (const e of setup.enemies) for (let i = 0; i < e.count; i++) list.push({ enemyId: e.enemyId, level: e.level });
    if (list.length) waves.push(list);
  }
  if (!waves.length) warnings.push("No enemies were picked.");

  const seed = setup.seed ?? R.randomSeed();
  const b: BattleState = {
    version: 1,
    rng: R.makeRng(seed),
    seed,
    turn: 0,
    phase: "planning",
    units,
    resources: { ally: { ...zeroSins(), ...setup.team.startResources }, enemy: zeroSins() },
    content,
    waves,
    waveIndex: -1,
    enemyTemplates: {},
    maxDeploy,
    turnLimit: enc?.turnLimit ?? 0,
    settings: { skillMode: "free", logDetail: "full", lowMoraleChance: 1, focused, ...setup.settings },
    plan: [],
    log: [],
    outcome: null,
    stats: {},
    egoUsed: [],
    resonance: zeroSins(),
    aResonance: Object.fromEntries(SINS.map((s) => [s, false])) as Record<Sin, boolean>,
    nextId: 0,
  };
  rememberTemplates(b, ws);
  spawnWave(b, ws, 0, warnings);
  for (const u of b.units) if (u.alive) stat(b, u);
  log(b, "turn", `Battle start${enc ? `: ${enc.name}` : ""}. Seed ${seed}.`);
  for (const u of b.units) if (u.alive) fireUnit("encounterStart", { b, self: u });
  fireTeam("encounterStart", b);
  startTurn(b);
  return { battle: b, warnings };
}

/** Add the enemies of wave `index`. Compiled enemies are kept so later waves need no workspace. */
export function spawnWave(b: BattleState, ws: Workspace | null, index: number, warnings: string[] = []) {
  const wave = b.waves[index];
  if (!wave) return false;
  b.waveIndex = index;
  let n = 0;
  for (const pick of wave) {
    const template = (ws?.enemies.find((e) => e.id === pick.enemyId) ?? (b.enemyTemplates[pick.enemyId] as Enemy | undefined)) as Enemy | undefined;
    if (!template) {
      warnings.push("An enemy in this fight no longer exists and was skipped.");
      continue;
    }
    b.enemyTemplates[template.id] = template;
    const uid = `w${index}e${n++}`;
    for (const u of enemyUnits(b.content, template, pick.level, uid)) {
      b.units.push(u);
      stat(b, u);
    }
  }
  if (index > 0) log(b, "turn", `Wave ${index + 1} arrives!`, undefined, { important: true });
  return true;
}

/** Prepare enemy templates for every wave up front (so the battle never needs the workspace again). */
export function rememberTemplates(b: BattleState, ws: Workspace) {
  for (const wave of b.waves) for (const pick of wave) {
    const e = ws.enemies.find((x) => x.id === pick.enemyId);
    if (e) b.enemyTemplates[e.id] = e;
  }
}

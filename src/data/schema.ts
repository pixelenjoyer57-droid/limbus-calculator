// Content schema: everything a user can author. Validated with zod on load and
// on import, so broken or old data is repaired instead of crashing the app.
import { z } from "zod";
import { DMG_TYPES, EGO_GRADES, GIFT_TIERS, SINNERS, SINS } from "../engine/constants";
import { TREMOR_TYPES } from "../engine/statuses";

export const SCHEMA_VERSION = 1;

const zSin = z.enum(SINS);
const zDmg = z.enum(DMG_TYPES);
const zSinner = z.enum(SINNERS);
const num = (def: number, min = -1e6, max = 1e6) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v), z.number().finite().min(min).max(max)).catch(def).default(def);
const int = (def: number, min = -1e6, max = 1e6) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v), z.number().finite().transform(Math.round).pipe(z.number().min(min).max(max))).catch(def).default(def);
const str = (def = "", max = 2000) => z.string().max(max).catch(def).default(def);
const bool = (def = false) => z.boolean().catch(def).default(def);
const id = () => z.string().min(1).max(80).catch(() => newId()).default(() => newId());

export function newId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID().slice(0, 18);
  return "id-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

// ---------------------------------------------------------------------------------
// Effect rules ("When X, if Y, do Z")
// ---------------------------------------------------------------------------------

export const WHO = [
  "self", "target", "mainTarget", "allAllies", "otherAllies", "allEnemies",
  "randomEnemy", "randomAlly", "lowestHpAlly", "lowestSpAlly", "fastestAlly", "slowestAlly",
  "lowestHpEnemy", "fastestEnemy", "alliesAfterSelf",
] as const;
export type Who = (typeof WHO)[number];

export const TRIGGERS = [
  // skill & coin
  "always", "onUse", "clashStart", "clashWin", "clashLose", "beforeAttack", "unopposedAttack",
  "attackEnd", "onKill", "onEvade",
  "coinStart", "onHit", "headsHit", "tailsHit", "hitAfterClashWin", "hitAfterClashLose",
  "hitWithoutCracking", "onCrit", "coinKill", "coinAttackEnd",
  // unit / passive / gift / status
  "encounterStart", "turnStart", "combatStart", "turnEnd",
  "whenHit", "onHitDealt", "onSkillUse", "onClashWinAny", "onClashLoseAny",
  "onKillAny", "onAllyDeath", "onEnemyStaggered", "whenStaggered", "onInflictStatus",
] as const;
export type Trigger = (typeof TRIGGERS)[number];

export const QUANTITIES = [
  "statusPotency", "statusCount", "statusSum", "statusOnAllEnemies",
  "hp", "hpPct", "missingHp", "missingHpPct", "maxHp", "sp", "speed", "speedDiff", "level",
  "staggerLevel", "shield", "negativeEffects", "positiveEffects",
  "clashCount", "headsCount", "tailsCount", "coinIndex", "coinCount",
  "turn", "alliesAlive", "enemiesAlive", "alliesDead", "resonance", "owned",
  "damageDealt", "skillDamage",
] as const;
export type QuantityKind = (typeof QUANTITIES)[number];

export const STATUS_FIELDS = ["potency", "count"] as const;

export const zQuantity = z.object({
  kind: z.enum(QUANTITIES).catch("statusPotency"),
  who: z.enum(WHO).catch("self").default("self"),
  status: str("BURN", 80),
  field: z.enum(STATUS_FIELDS).catch("potency").default("potency"),
  sin: zSin.catch("WRATH").default("WRATH"),
});
export type Quantity = z.infer<typeof zQuantity>;

export const zValue = z.object({
  base: num(0),
  per: z
    .object({
      q: zQuantity,
      q2: zQuantity.nullable().catch(null).default(null), // optional second number added to q ("for every 5 (Burn + Tremor)")
      every: num(1, 0.0001, 1e6),
      amount: num(1),
    })
    .nullable()
    .catch(null)
    .default(null),
  min: z.number().finite().nullable().catch(null).default(null),
  max: z.number().finite().nullable().catch(null).default(null),
});
export type Value = z.infer<typeof zValue>;
export const val = (base: number): Value => ({ base, per: null, min: null, max: null });

export const OPS = [">=", "<=", ">", "<", "==", "!="] as const;

export const CONDITIONS = [
  "compare", "hasStatus", "isStaggered", "isHeads", "isTails", "isCrit", "isReuse",
  "skillSin", "skillDmgType", "skillSlot", "skillInflicts", "clashWon", "clashLost", "unopposed",
  "chance", "absoluteResonance", "targetIsEnemy", "sinner", "trait", "isPanicked", "statusIs",
] as const;
export type ConditionKind = (typeof CONDITIONS)[number];
export const SKILL_SLOTS = ["S1", "S2", "S3", "DEF", "EGO"] as const;

export const zCondition = z.object({
  kind: z.enum(CONDITIONS).catch("compare"),
  not: bool(false),
  who: z.enum(WHO).catch("target").default("target"),
  q: zQuantity.nullable().catch(null).default(null),
  q2: zQuantity.nullable().catch(null).default(null), // optional second number added to q
  op: z.enum(OPS).catch(">=").default(">="),
  value: num(1),
  status: str("BURN", 80),
  sin: zSin.catch("WRATH").default("WRATH"),
  dmgType: zDmg.catch("SLASH").default("SLASH"),
  slot: z.enum(SKILL_SLOTS).catch("S1").default("S1"),
  text: str("", 120),
});
export type Condition = z.infer<typeof zCondition>;

export const ACTIONS = [
  "inflict", "reduceStatus", "removeStatus", "healHp", "loseHp", "fixedDamage", "coinDamagePct",
  "healSp", "loseSp", "shield", "tremorBurst", "convertTremor", "sinkingDeluge",
  "raiseStaggerThreshold", "gainResource", "reuseCoin", "forceStagger", "mod", "note", "triggerStatus",
] as const;
export type ActionKind = (typeof ACTIONS)[number];

export const MOD_STATS = [
  "basePower", "coinPower", "finalPower", "clashPower", "offenseLevel", "defenseLevel",
  "dmgDealt", "dmgTaken", "critChance", "critDmg", "atkWeight", "headsChance", "speed",
  "statusDmgTaken", "resist", "cannotBeStaggered", "cannotStagger",
] as const;
export type ModStat = (typeof MOD_STATS)[number];
export const MOD_SCOPES = ["skill", "coin", "turn", "nextTurn"] as const;
export type ModScope = (typeof MOD_SCOPES)[number];
export const HP_MODES = ["flat", "pctMax", "pctMissing"] as const;
export const TIMINGS = ["now", "nextTurn"] as const;

export const zAction = z.object({
  kind: z.enum(ACTIONS).catch("note"),
  who: z.enum(WHO).catch("target").default("target"),
  count: int(1, 1, 12), // how many units for random / "after self" selectors
  status: str("BURN", 80),
  potency: zValue.catch(val(0)).default(val(0)),
  amount: zValue.catch(val(1)).default(val(1)),
  timing: z.enum(TIMINGS).catch("now").default("now"),
  field: z.enum(STATUS_FIELDS).catch("count").default("count"),
  hpMode: z.enum(HP_MODES).catch("flat").default("flat"),
  stat: z.enum(MOD_STATS).catch("dmgDealt").default("dmgDealt"),
  scope: z.enum(MOD_SCOPES).catch("skill").default("skill"),
  sin: zSin.nullable().catch(null).default(null),
  dmgType: zDmg.nullable().catch(null).default(null),
  coin: int(0, 0, 10), // 0 = every coin, n = only coin n (for coinPower mods)
  tremorType: z.enum(TREMOR_TYPES).catch("DECAY").default("DECAY"),
  entangle: bool(false),
  text: str("", 400),
});
export type Action = z.infer<typeof zAction>;

export const zEffect = z.object({
  id: id(),
  trigger: z.enum(TRIGGERS).catch("onHit"),
  conditions: z.array(zCondition).catch([]).default([]),
  actions: z.array(zAction).catch([]).default([]),
  perTurn: int(0, 0, 99), // 0 = unlimited
  perEncounter: int(0, 0, 99),
  perUse: int(0, 0, 99), // at most N times per Skill use; 0 = unlimited
  text: str("", 400), // optional custom wording shown instead of the generated text
});
export type Effect = z.infer<typeof zEffect>;

// ---------------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------------
export const SKILL_KINDS = ["attack", "guard", "evade", "counter"] as const;
export type SkillKind = (typeof SKILL_KINDS)[number];
export const COIN_KINDS = ["normal", "unbreakable", "excision"] as const;

export const COIN_OPS = ["add", "multiply"] as const;
export const COIN_FIXED = ["heads", "tails"] as const;

/**
 * One coin of a skill. Everything except `kind`/`effects` is optional: null means
 * "same as the skill" (or as the coin's custom type, when one is picked).
 */
export const zCoin = z.object({
  kind: z.enum(COIN_KINDS).catch("normal").default("normal"),
  customType: z.string().max(80).nullable().catch(null).default(null), // key of a custom coin type
  power: z.number().finite().transform(Math.round).pipe(z.number().min(-99).max(99)).nullable().catch(null).default(null), // own Coin Power
  op: z.enum(COIN_OPS).nullable().catch(null).default(null), // "multiply": Heads multiplies the skill's power
  mult: z.number().finite().min(0).max(10).nullable().catch(null).default(null),
  dmgType: zDmg.nullable().catch(null).default(null), // "This coin deals Slash damage"
  sin: zSin.nullable().catch(null).default(null),
  headsBonus: int(0, -100, 100), // +X% chance to land Heads
  fixed: z.enum(COIN_FIXED).nullable().catch(null).default(null), // always Heads / always Tails
  effects: z.array(zEffect).catch([]).default([]),
});
export type Coin = z.infer<typeof zCoin>;
export const newCoin = (kind: (typeof COIN_KINDS)[number] = "normal", extra: Partial<Coin> = {}): Coin => ({
  kind, customType: null, power: null, op: null, mult: null, dmgType: null, sin: null, headsBonus: 0, fixed: null, effects: [], ...extra,
});

/** A reusable custom coin type (like a custom status, but for coins). */
export const zCoinType = z.object({
  id: id(),
  kind: z.literal("coinType").catch("coinType").default("coinType"),
  key: z.string().min(1).max(80).catch(() => "COIN_" + newId()).default(() => "COIN_" + newId()),
  name: str("New Coin Type", 60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).catch("#e0ae4d").default("#e0ae4d"),
  description: str("", 1000),
  clash: z.enum(COIN_KINDS).catch("normal").default("normal"), // what happens when it loses a Clash round
  power: z.number().finite().transform(Math.round).pipe(z.number().min(-99).max(99)).nullable().catch(null).default(null),
  op: z.enum(COIN_OPS).catch("add").default("add"),
  mult: num(2, 0, 10),
  dmgType: zDmg.nullable().catch(null).default(null),
  sin: zSin.nullable().catch(null).default(null),
  headsBonus: int(0, -100, 100),
  fixed: z.enum(["none", ...COIN_FIXED]).catch("none").default("none"),
  ignoreParalyze: bool(false),
  crackedPower: int(1, 0, 99), // Coin Power of a cracked coin (the game uses 1)
  effects: z.array(zEffect).catch([]).default([]),
  notes: str("", 4000),
  tags: z.array(z.string().max(40)).max(30).catch([]).default([]),
  createdAt: num(0),
  updatedAt: num(0),
});
export type CoinType = z.infer<typeof zCoinType>;

export const zSkill = z.object({
  id: id(),
  name: str("Skill", 80),
  kind: z.enum(SKILL_KINDS).catch("attack").default("attack"),
  clashable: bool(false), // Clashable Guard / Clashable Counter
  sin: zSin.nullable().catch("WRATH").default("WRATH"),
  dmgType: zDmg.catch("SLASH").default("SLASH"),
  basePower: int(4, -99, 999),
  coinPower: int(4, -99, 99),
  coins: z.array(zCoin).min(1).max(12).catch(() => [newCoin()]).default(() => [newCoin()]),
  levelMod: int(0, -30, 30),
  atkWeight: int(1, 1, 12),
  amount: int(1, 0, 9), // copies in the skill deck (Sinners only); 0 = never drawn, but pickable
  label: str("", 12), // short slot label of a sub-skill, e.g. "S1-2" (empty = none)
  /** Explicit attack slot of an Identity skill; null = decided by position (S1, S2, S3, then S3). */
  slot: z.enum(["S1", "S2", "S3"]).nullable().catch(null).default(null),
  unclashable: bool(false),
  indiscriminate: bool(false),
  effects: z.array(zEffect).catch([]).default([]),
  notes: str("", 2000),
});
export type Skill = z.infer<typeof zSkill>;

/** Swap the item at `i` with its neighbour (dir -1 up / +1 down) in place. Explicit slots travel with their skill. */
export function moveItem<T>(list: T[], i: number, dir: -1 | 1): void {
  const j = i + dir;
  if (j < 0 || j >= list.length || i < 0 || i >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
}

export type AttackSlot = "S1" | "S2" | "S3";
/** The slot an Identity attack skill occupies: its explicit `slot`, else by position. */
export function identitySkillSlot(skill: Pick<Skill, "slot">, index: number): AttackSlot {
  return skill.slot ?? ((["S1", "S2", "S3"] as const)[index] ?? "S3");
}

export const PASSIVE_KINDS = ["combat", "support"] as const;
export const zPassive = z.object({
  id: id(),
  name: str("Passive", 80),
  kind: z.enum(PASSIVE_KINDS).catch("combat").default("combat"),
  reqMode: z.enum(["none", "res", "owned"]).catch("none").default("none"),
  reqSin: zSin.catch("WRATH").default("WRATH"),
  reqCount: int(3, 0, 30),
  effects: z.array(zEffect).catch([]).default([]),
  notes: str("", 2000),
});
export type Passive = z.infer<typeof zPassive>;

const zPhys = z.object({ SLASH: num(1, 0, 10), PIERCE: num(1, 0, 10), BLUNT: num(1, 0, 10) });
export type PhysResist = z.infer<typeof zPhys>;
const sinRecord = (def: number) =>
  z.object(Object.fromEntries(SINS.map((s) => [s, num(def, 0, 10)])) as Record<(typeof SINS)[number], ReturnType<typeof num>>);
const zSinResist = sinRecord(1);
export type SinResist = z.infer<typeof zSinResist>;
const zSinCost = z.object(Object.fromEntries(SINS.map((s) => [s, int(0, 0, 99)])) as Record<(typeof SINS)[number], ReturnType<typeof int>>);
export type SinCost = z.infer<typeof zSinCost>;
const thresholds = () => z.array(num(50, -100, 100)).max(10).catch([]).default([]);
const meta = {
  notes: str("", 4000),
  /** Where the item came from: the wiki page for game data (and copies of it). */
  source: str("", 300),
  tags: z.array(z.string().max(40)).max(30).catch([]).default([]),
  createdAt: num(0),
  updatedAt: num(0),
};

// ---------------------------------------------------------------------------------
// Content types
// ---------------------------------------------------------------------------------
export const zIdentity = z.object({
  id: id(),
  kind: z.literal("identity").catch("identity").default("identity"),
  name: str("New Identity", 80),
  sinner: zSinner.catch("Yi Sang").default("Yi Sang"),
  rarity: int(3, 1, 3),
  level: int(65, 1, 200), // the level the stats below are written for
  hp: int(230, 1, 99999),
  hpPerLevel: num(3, 0, 1000),
  speedMin: int(3, 1, 99),
  speedMax: int(6, 1, 99),
  defenseMod: int(0, -30, 30),
  staggerThresholds: thresholds(),
  resist: zPhys.catch({ SLASH: 1, PIERCE: 1, BLUNT: 1 }),
  skills: z.array(zSkill).max(12).catch(() => []).default(() => []),
  defense: z.array(zSkill).max(4).catch(() => []).default(() => []),
  passives: z.array(zPassive).max(8).catch([]).default([]),
  traits: z.array(z.string().max(40)).max(20).catch([]).default([]),
  ...meta,
});
export type Identity = z.infer<typeof zIdentity>;

export const zEgo = z.object({
  id: id(),
  kind: z.literal("ego").catch("ego").default("ego"),
  name: str("New E.G.O", 80),
  sinner: zSinner.catch("Yi Sang").default("Yi Sang"),
  grade: z.enum(EGO_GRADES).catch("TETH").default("TETH"),
  cost: zSinCost.catch(Object.fromEntries(SINS.map((s) => [s, 0])) as SinCost),
  spCost: int(20, 0, 999),
  sinResist: zSinResist.catch(Object.fromEntries(SINS.map((s) => [s, 1])) as SinResist),
  awakening: zSkill.catch(() => zSkill.parse({ name: "Awakening" })),
  corrosion: zSkill.nullable().catch(null).default(null),
  passive: zPassive.nullable().catch(null).default(null),
  ...meta,
});
export type Ego = z.infer<typeof zEgo>;

export const zPart = z.object({
  id: id(),
  name: str("Part", 60),
  hp: int(500, 1, 999999),
  hpPerLevel: num(0, 0, 100000), // HP gained per level when the enemy's level is changed
  speedMin: z.number().int().min(1).max(99).nullable().catch(null).default(null), // null = the enemy's Speed
  speedMax: z.number().int().min(1).max(99).nullable().catch(null).default(null),
  staggerThresholds: thresholds(), // a Part's own thresholds (% of its HP); empty = use the enemy's
  defenseMod: int(0, -30, 30),
  resist: zPhys.catch({ SLASH: 1, PIERCE: 1, BLUNT: 1 }),
  sinResist: zSinResist.catch(Object.fromEntries(SINS.map((s) => [s, 1])) as SinResist),
  breakable: z.enum(["destructible", "severable", "indestructible"]).catch("destructible").default("destructible"),
  slots: int(1, 0, 8),
  skills: z.array(zSkill).max(12).catch([]).default([]),
});
export type Part = z.infer<typeof zPart>;

export const zEnemy = z.object({
  id: id(),
  kind: z.literal("enemy").catch("enemy").default("enemy"),
  name: str("New Enemy", 80),
  level: int(40, 1, 999),
  hp: int(300, 1, 9999999), // HP at `level`
  hpPerLevel: num(0, 0, 100000), // HP gained per level above `level` (encounters can change the level)
  speedMin: int(2, 1, 99),
  speedMax: int(5, 1, 99),
  defenseMod: int(0, -30, 30),
  staggerThresholds: thresholds(),
  resist: zPhys.catch({ SLASH: 1, PIERCE: 1, BLUNT: 1 }),
  sinResist: zSinResist.catch(Object.fromEntries(SINS.map((s) => [s, 1])) as SinResist),
  hasSanity: bool(true),
  startSp: int(0, -45, 45),
  panicRecovery: bool(false),
  slots: int(1, 0, 12), // skill slots on turn 1
  slotsMax: int(1, 0, 12), // gains 1 slot per turn up to this
  pattern: z.enum(["random", "rotation"]).catch("random").default("random"),
  rotation: z.array(z.array(z.string())).max(20).catch([]).default([]), // per turn: skill ids per slot
  skills: z.array(zSkill).max(16).catch([]).default([]),
  passives: z.array(zPassive).max(10).catch([]).default([]),
  parts: z.array(zPart).max(8).catch([]).default([]),
  ...meta,
});
export type Enemy = z.infer<typeof zEnemy>;

export const zEncounter = z.object({
  id: id(),
  kind: z.literal("encounter").catch("encounter").default("encounter"),
  name: str("New Encounter", 80),
  type: z.enum(["normal", "risky", "focused", "abnormality", "boss"]).catch("normal").default("normal"),
  maxDeploy: int(6, 1, 12),
  turnLimit: int(0, 0, 99), // 0 = none (the game ends at 99 anyway)
  startSp: int(0, -45, 45),
  waves: z
    .array(z.object({
      id: id(),
      enemies: z.array(z.object({ enemyId: z.string().catch(""), count: int(1, 1, 10), level: int(0, 0, 999), slots: int(0, 0, 12) })).max(12).catch([]).default([]),
    }))
    .max(10)
    .catch([])
    .default([]),
  ...meta,
});
export type Encounter = z.infer<typeof zEncounter>;

export const GIFT_KEYWORDS = ["NONE", "BURN", "BLEED", "TREMOR", "RUPTURE", "SINKING", "POISE", "CHARGE", "SLASH", "PIERCE", "BLUNT"] as const;
export const zGift = z.object({
  id: id(),
  kind: z.literal("gift").catch("gift").default("gift"),
  name: str("New E.G.O Gift", 80),
  tier: z.enum(GIFT_TIERS).catch("I").default("I"),
  keyword: z.enum(GIFT_KEYWORDS).catch("NONE").default("NONE"),
  cost: int(150, 0, 9999),
  scope: z.enum(["eachAlly", "team"]).catch("eachAlly").default("eachAlly"),
  effects: z.array(zEffect).catch([]).default([]),
  plus1: z.array(zEffect).nullable().catch(null).default(null),
  plus2: z.array(zEffect).nullable().catch(null).default(null),
  ...meta,
});
export type Gift = z.infer<typeof zGift>;

export const zCustomStatus = z.object({
  id: id(),
  kind: z.literal("status").catch("status").default("status"),
  key: z.string().min(1).max(80).catch(() => "CUSTOM_" + newId()).default(() => "CUSTOM_" + newId()),
  name: str("New Status", 60),
  polarity: z.enum(["positive", "negative", "neutral"]).catch("negative").default("negative"),
  mode: z.enum(["pc", "value"]).catch("value").default("value"),
  maxPotency: int(99, 1, 999),
  maxCount: int(99, 1, 999),
  turnEnd: z.enum(["none", "countMinus1", "expire", "halve", "potencyMinus1"]).catch("none").default("none"),
  countsAs: z.string().max(80).nullable().catch(null).default(null),
  description: str("", 1000),
  effects: z.array(zEffect).catch([]).default([]),
  ...meta,
});
export type CustomStatus = z.infer<typeof zCustomStatus>;

export const OUTCOME_KINDS = ["hp", "sp", "status", "gift", "cost", "resource", "text"] as const;
export const zOutcome = z.object({
  id: id(),
  kind: z.enum(OUTCOME_KINDS).catch("text").default("text"),
  target: z.enum(["chosen", "all", "random"]).catch("chosen").default("chosen"),
  amount: num(0),
  pct: bool(false),
  status: str("BURN", 80),
  giftId: str("", 80),
  sin: zSin.catch("WRATH").default("WRATH"),
  text: str("", 600),
});
export type Outcome = z.infer<typeof zOutcome>;
export const zEventChoice = z.object({
  id: id(),
  label: str("Choice", 200),
  hasCheck: bool(false),
  checkTarget: int(10, 0, 999),
  checkAtMost: bool(false), // "final number must be lower" checks
  advantageSins: z.array(zSin).max(7).catch([]).default([]),
  advantageAmount: int(3, 0, 99),
  bonuses: z
    .array(z.object({ id: id(), match: z.enum(["sinner", "trait"]).catch("sinner"), value: str("", 60), amount: int(0, -99, 99) }))
    .max(12)
    .catch([])
    .default([]),
  success: z.array(zOutcome).catch([]).default([]),
  failure: z.array(zOutcome).catch([]).default([]),
});
export type EventChoice = z.infer<typeof zEventChoice>;
export const zGameEvent = z.object({
  id: id(),
  kind: z.literal("event").catch("event").default("event"),
  name: str("New Event", 80),
  intro: str("", 4000),
  choices: z.array(zEventChoice).max(8).catch([]).default([]),
  ...meta,
});
export type GameEvent = z.infer<typeof zGameEvent>;

export const zTeamMember = z.object({
  identityId: z.string().nullable().catch(null).default(null),
  level: int(65, 1, 200),
  uptie: int(4, 1, 4),
  egos: z.object(Object.fromEntries(EGO_GRADES.map((g) => [g, z.string().nullable().catch(null).default(null)])) as Record<(typeof EGO_GRADES)[number], z.ZodDefault<z.ZodCatch<z.ZodNullable<z.ZodString>>>>).catch({ ZAYIN: null, TETH: null, HE: null, WAW: null, ALEPH: null }),
});
export type TeamMember = z.infer<typeof zTeamMember>;
export const zTeam = z.object({
  id: id(),
  kind: z.literal("team").catch("team").default("team"),
  name: str("New Team", 80),
  members: z.record(zSinner, zTeamMember).catch({}).default({}),
  deploy: z.array(zSinner).max(12).catch([]).default([]),
  gifts: z.array(z.object({ giftId: z.string(), level: int(0, 0, 2) })).max(80).catch([]).default([]),
  startResources: zSinCost.catch(Object.fromEntries(SINS.map((s) => [s, 0])) as SinCost),
  ...meta,
});
export type Team = z.infer<typeof zTeam>;

export const zWorkspace = z.object({
  schemaVersion: z.number().catch(SCHEMA_VERSION).default(SCHEMA_VERSION),
  id: id(),
  name: str("My Workshop", 80),
  createdAt: num(0),
  updatedAt: num(0),
  identities: z.array(zIdentity).catch([]).default([]),
  egos: z.array(zEgo).catch([]).default([]),
  enemies: z.array(zEnemy).catch([]).default([]),
  encounters: z.array(zEncounter).catch([]).default([]),
  events: z.array(zGameEvent).catch([]).default([]),
  gifts: z.array(zGift).catch([]).default([]),
  statuses: z.array(zCustomStatus).catch([]).default([]),
  coinTypes: z.array(zCoinType).catch([]).default([]),
  teams: z.array(zTeam).catch([]).default([]),
});
export type Workspace = z.infer<typeof zWorkspace>;

export type ContentKind = "identity" | "ego" | "enemy" | "encounter" | "event" | "gift" | "status" | "coinType" | "team";
export type AnyContent = Identity | Ego | Enemy | Encounter | GameEvent | Gift | CustomStatus | CoinType | Team;
export const COLLECTION: Record<ContentKind, keyof Workspace> = {
  identity: "identities",
  ego: "egos",
  enemy: "enemies",
  encounter: "encounters",
  event: "events",
  gift: "gifts",
  status: "statuses",
  coinType: "coinTypes",
  team: "teams",
};
export const SCHEMA_BY_KIND = {
  identity: zIdentity,
  ego: zEgo,
  enemy: zEnemy,
  encounter: zEncounter,
  event: zGameEvent,
  gift: zGift,
  status: zCustomStatus,
  coinType: zCoinType,
  team: zTeam,
} as const;

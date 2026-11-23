// Runtime battle state. Everything is plain JSON so a battle can be saved to
// storage mid-fight and resumed later, or sent to a Web Worker.
import type { DmgType, Sin, Sinner } from "./constants";
import type { CoinType, Effect, ModStat, Passive, PhysResist, SinResist, Skill } from "../data/schema";
import type { StatusDef, TremorType } from "./statuses";

export type Side = "ally" | "enemy";
export type SkillSlot = "S1" | "S2" | "S3" | "DEF" | "EGO" | "ENEMY";

/** A skill compiled into the battle snapshot. `key` is unique inside the battle. */
export interface CSkill extends Omit<Skill, "slot"> {
  key: string;
  slot: SkillSlot;
  egoKey?: string; // set for E.G.O awakening / corrosion skills
  corrosion?: boolean;
  part?: string; // enemy part name
}

export interface CPassive extends Passive {
  key: string;
  ego?: boolean;
}

export interface CEgo {
  key: string;
  name: string;
  grade: string;
  cost: Record<Sin, number>;
  spCost: number;
  sinResist: SinResist;
  awakening: string; // skill key
  corrosion: string | null;
  passive: string | null;
}

export interface CStatusDef extends StatusDef {
  effects: Effect[];
  turnEnd: "none" | "countMinus1" | "expire" | "halve" | "potencyMinus1";
}

export interface CGift {
  key: string;
  name: string;
  scope: "eachAlly" | "team";
  effects: Effect[];
}

export interface BattleContent {
  skills: Record<string, CSkill>;
  passives: Record<string, CPassive>;
  egos: Record<string, CEgo>;
  statuses: Record<string, CStatusDef>; // custom statuses only (built-ins live in code)
  gifts: CGift[];
  coinTypes?: Record<string, CoinType>; // custom coin types by key
}

export interface StatusInstance {
  key: string;
  potency: number;
  count: number;
  tremorTypes?: TremorType[];
  entangled?: boolean;
}

export interface TempMod {
  stat: ModStat;
  value: number;
  sin?: Sin | null;
  dmgType?: DmgType | null;
  status?: string;
  coin?: number; // 0/undefined = all coins
  label: string;
}

export interface Threshold {
  pct: number;
  hp: number;
  triggered: boolean;
}

export interface UnitState {
  uid: string;
  side: Side;
  name: string;
  kind: "identity" | "enemy" | "part" | "core";
  sourceId: string;
  sinner?: Sinner;
  traits: string[];
  level: number;
  maxHp: number;
  hp: number;
  shield: number;
  hasSanity: boolean;
  sp: number;
  panicRecovery: boolean;
  panic: "none" | "lowMorale" | "panic";
  panicTurn: number;
  panicLocked?: boolean;
  speedMin: number;
  speedMax: number;
  speed: number;
  defenseMod: number;
  resist: PhysResist;
  sinResist: SinResist;
  thresholds: Threshold[];
  stagger: number; // 0..3
  staggerTurn: number;
  statuses: StatusInstance[];
  pending: StatusInstance[]; // applied at the next Turn Start
  mods: TempMod[]; // active until Turn End
  pendingMods: TempMod[]; // become active next turn
  alive: boolean;
  targetable: boolean;
  deployOrder: number;
  slots: number;
  slotsMax: number;
  attackSkills: string[];
  defenseSkills: string[];
  egos: string[];
  passives: string[]; // combat passives
  supportPassives: string[];
  activePassives: string[]; // combat passives whose requirement passed this turn
  egoPassives: string[]; // E.G.O passives activated by using the E.G.O
  egoPassivesPending: string[];
  coreUid?: string;
  breakable?: "destructible" | "severable" | "indestructible";
  broken?: boolean;
  slotWeight: number;
  deck?: { list: string[]; hand: string[][] };
  rotationIndex: number;
  pattern: "random" | "rotation";
  rotation: string[][];
  turn: { hpLost: number; spLost: number; damageDealt: number; acted: boolean };
  limits: Record<string, number>; // per-turn effect uses
  encLimits: Record<string, number>; // per-encounter effect uses
  deathTurn?: number;
}

export interface PlannedAction {
  id: string;
  uid: string;
  side: Side;
  slot: number;
  skill: string | null;
  target: string | null; // main target unit uid
  targetAction: string | null; // the opposing planned action this one aims at
  ego?: { key: string; overclock: boolean } | null;
  done?: boolean;
  clashWith?: string | null; // filled at Combat Start
  resonance?: number; // Offense/Defense Level bonus from Sin Resonance
  aRes?: boolean;
  note?: string;
}

export interface ClashSideInfo {
  name: string;
  skill: string;
  side: Side;
  sin: Sin | null;
  coins: number;
}
export interface ClashRollLog {
  coins: string; // "H" / "T" / "P" (paralyzed) per active coin, in order
  base: number;
  coinAdd: number;
  mult: number;
  finalPower: number;
  clashMods: { label: string; value: number }[];
  total: number;
}
export interface ClashRoundLog {
  a: ClashRollLog;
  b: ClashRollLog;
  result: "a" | "b" | "tie";
  broke?: { side: "a" | "b"; coin: number; cracked: boolean; left: number };
}
export interface ClashLog {
  a: ClashSideInfo;
  b: ClashSideInfo;
  rounds: ClashRoundLog[];
  winner: "a" | "b" | null;
  outcome: "win" | "cancelled" | "interrupted";
}

export interface LogEntry {
  turn: number;
  kind: "turn" | "info" | "clash" | "attack" | "damage" | "status" | "stagger" | "death" | "sp" | "effect" | "warn" | "result";
  text: string;
  details?: string[];
  clash?: ClashLog;
  side?: Side;
  important?: boolean;
}

export interface BattleSettings {
  /** "free": pick any skill each turn. "deck": draw from the 3/2/1 skill list like the game. */
  skillMode: "free" | "deck";
  logDetail: "full" | "summary" | "none";
  lowMoraleChance: number;
  forceCoins?: { ally?: "heads" | "tails"; enemy?: "heads" | "tails" };
  forceCrit?: "always" | "never";
  focused: boolean;
  /** Calculator: treat every passive requirement (Res / Owned) as met. */
  assumePassives?: boolean;
}

export interface UnitStats {
  name: string;
  side: Side;
  damageDealt: number;
  damageTaken: number;
  statusDamageDealt: number;
  clashesWon: number;
  clashesLost: number;
  kills: number;
  hpEnd: number;
  maxHp: number;
  alive: boolean;
}

export interface BattleState {
  version: 1;
  rng: { state: number };
  seed: number;
  turn: number;
  phase: "planning" | "ended";
  units: UnitState[];
  resources: Record<Side, Record<Sin, number>>;
  content: BattleContent;
  waves: { enemyId: string; level: number; slots?: number }[][];
  waveIndex: number;
  enemyTemplates: Record<string, unknown>; // compiled enemies for later waves
  maxDeploy: number;
  turnLimit: number;
  settings: BattleSettings;
  plan: PlannedAction[];
  log: LogEntry[];
  outcome: "win" | "loss" | null;
  stats: Record<string, UnitStats>;
  egoUsed: string[]; // ego keys used this turn
  resonance: Record<Sin, number>;
  aResonance: Record<Sin, boolean>;
  nextId: number;
}

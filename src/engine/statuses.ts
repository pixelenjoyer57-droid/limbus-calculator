// Built-in status effects. Descriptions follow the in-game wording collected on the
// wiki's Status Effects page. Behaviour lives in the engine (see combat/*.ts); this
// file is the single registry used by the engine, the editors and the help screen.
import { DMG_LABEL, DMG_TYPES, SIN_LABEL, SINS, type DmgType, type Sin } from "./constants";

export type StatusMode = "pc" | "value"; // potency+count, or a single value
export type Polarity = "positive" | "negative" | "neutral";

export interface StatusDef {
  key: string;
  name: string;
  polarity: Polarity;
  mode: StatusMode;
  maxPotency: number;
  maxCount: number;
  /** Expires at Turn End (the "for one turn" effects). */
  oneTurn: boolean;
  description: string;
  /** Linked sin for the seven keyword statuses. */
  sin?: Sin;
  group: "keyword" | "power" | "damage" | "defense" | "speed" | "level" | "coin" | "resist" | "other";
  /** Restricts the effect to skills of this damage type or sin. */
  dmgType?: DmgType;
  sinFilter?: Sin;
  /** Custom statuses can declare they count as a keyword status ("Unique Burn"). */
  countsAs?: string;
  custom?: boolean;
}

const defs: StatusDef[] = [];
function add(d: Omit<StatusDef, "maxPotency" | "maxCount"> & { maxPotency?: number; maxCount?: number }) {
  defs.push({ maxPotency: 99, maxCount: 99, ...d });
}

// ---- The seven keyword statuses -------------------------------------------------
add({ key: "BURN", name: "Burn", polarity: "negative", mode: "pc", oneTurn: false, group: "keyword", sin: "WRATH",
  description: "Turn End: take fixed damage equal to Potency, then reduce Count by 1. Max 99 Potency and Count." });
add({ key: "BLEED", name: "Bleed", polarity: "negative", mode: "pc", oneTurn: false, group: "keyword", sin: "LUST",
  description: "When tossing an Attack Skill Coin (and in every Clash round with an Attack Skill), take fixed damage equal to Potency, then reduce Count by 1. Bleed damage cannot Stagger by itself." });
add({ key: "TREMOR", name: "Tremor", polarity: "negative", mode: "pc", oneTurn: false, group: "keyword", sin: "SLOTH",
  description: "When hit by an attack that triggers Tremor Burst, raise the Stagger Threshold by Potency (in HP), then reduce Count by 1. Turn End: reduce Count by 1." });
add({ key: "RUPTURE", name: "Rupture", polarity: "negative", mode: "pc", oneTurn: false, group: "keyword", sin: "GLUTTONY",
  description: "When hit by an attack, take fixed damage equal to Potency, then reduce Count by 1." });
add({ key: "SINKING", name: "Sinking", polarity: "negative", mode: "pc", oneTurn: false, group: "keyword", sin: "GLOOM",
  description: "When hit by an attack, take SP damage equal to Potency, then reduce Count by 1. Units without SP (or with fixed SP) take Gloom-affinity damage instead (uses Gloom resistance only)." });
add({ key: "POISE", name: "Poise", polarity: "positive", mode: "pc", oneTurn: false, group: "keyword", sin: "PRIDE",
  description: "On hit, (Potency × 5)% chance to deal a Critical Hit (+20% damage), reducing Count by 1 when it happens. Turn End: reduce Count by 1." });
add({ key: "CHARGE", name: "Charge", polarity: "positive", mode: "pc", oneTurn: false, group: "keyword", sin: "ENVY", maxCount: 20,
  description: "Resource spent by skills. Turn End: Count −1. Max Count 20. At 2+ Potency the effect does not expire when Count reaches 0." });

// ---- One-turn buffs ---------------------------------------------------------------
const oneTurn = (key: string, name: string, polarity: Polarity, group: StatusDef["group"], description: string, extra: Partial<StatusDef> = {}) =>
  add({ key, name, polarity, mode: "value", oneTurn: true, group, description, ...extra });

oneTurn("DAMAGE_UP", "Damage Up", "positive", "damage", "Deal +10% damage with skills per Count for one turn. (Max 10)", { maxCount: 10 });
oneTurn("DAMAGE_DOWN", "Damage Down", "negative", "damage", "Deal 10% less damage with skills per Count for one turn. (Max 10)", { maxCount: 10 });
oneTurn("FRAGILE", "Fragile", "negative", "defense", "Take +10% damage from skills per Count for one turn. (Max 10)", { maxCount: 10 });
oneTurn("PROTECTION", "Protection", "positive", "defense", "Take 10% less damage from attacks per Count for one turn. (Max 10)", { maxCount: 10 });
oneTurn("POWER_UP", "Power Up", "positive", "power", "All skills gain Final Power by Count for one turn.");
oneTurn("POWER_DOWN", "Power Down", "negative", "power", "All skills lose Final Power by Count for one turn.");
oneTurn("ATTACK_POWER_UP", "Attack Power Up", "positive", "power", "Attack skills gain Final Power by Count for one turn.");
oneTurn("ATTACK_POWER_DOWN", "Attack Power Down", "negative", "power", "Attack skills lose Final Power by Count for one turn.");
oneTurn("DEFENSE_POWER_UP", "Defense Power Up", "positive", "power", "Defense skills gain Final Power by Count for one turn.");
oneTurn("DEFENSE_POWER_DOWN", "Defense Power Down", "negative", "power", "Defense skills lose Final Power by Count for one turn.");
oneTurn("BASE_POWER_UP", "Base Power Up", "positive", "power", "Raise the Base Power of skills by Count for one turn.");
oneTurn("CLASH_POWER_UP", "Clash Power Up", "positive", "power", "Gain Clash Power by Count for one turn (Clash only, not damage).");
oneTurn("CLASH_POWER_DOWN", "Clash Power Down", "negative", "power", "Lose Clash Power by Count for one turn (Clash only, not damage).");
oneTurn("OFFENSE_LEVEL_UP", "Offense Level Up", "positive", "level", "Offense Level +Count for one turn.");
oneTurn("OFFENSE_LEVEL_DOWN", "Offense Level Down", "negative", "level", "Offense Level −Count for one turn.");
oneTurn("DEFENSE_LEVEL_UP", "Defense Level Up", "positive", "level", "Defense Level +Count for one turn.");
oneTurn("DEFENSE_LEVEL_DOWN", "Defense Level Down", "negative", "level", "Defense Level −Count for one turn.");
oneTurn("HASTE", "Haste", "positive", "speed", "Speed +Count for one turn.");
oneTurn("BIND", "Bind", "negative", "speed", "Speed −Count for one turn (Speed cannot go below 1).");
oneTurn("PARALYZE", "Paralyze", "negative", "coin", "Fix the Power of the next X Coin(s) tossed to 0 for one turn (1 Count used per Coin).");
oneTurn("PLUS_COIN_BOOST", "Plus Coin Boost", "positive", "coin", "Raise the Power of Plus Coins by Count for one turn.");
oneTurn("PLUS_COIN_DROP", "Plus Coin Drop", "negative", "coin", "Reduce the Power of Plus Coins by Count for one turn (not below 0).");
oneTurn("MINUS_COIN_DROP", "Minus Coin Drop", "positive", "coin", "Reduce the penalty of Minus Coins by Count for one turn (not above 0).");
oneTurn("MINUS_COIN_BOOST", "Minus Coin Boost", "negative", "coin", "Make Minus Coins Count more negative for one turn.");
oneTurn("CRIT_DMG_UP", "Crit DMG Up", "positive", "damage", "Deal +10% damage on Critical Hit per Count for one turn.");
oneTurn("IMMOBILIZED", "Immobilized", "negative", "other", "Does not act for this turn.");

for (const d of DMG_TYPES) {
  oneTurn(`${d}_DMG_UP`, `${DMG_LABEL[d]} DMG Up`, "positive", "damage", `Deal +10% damage with ${DMG_LABEL[d]} skills per Count for one turn. (Max 10)`, { maxCount: 10, dmgType: d });
  oneTurn(`${d}_DMG_DOWN`, `${DMG_LABEL[d]} DMG Down`, "negative", "damage", `Deal 10% less damage with ${DMG_LABEL[d]} skills per Count for one turn. (Max 10)`, { maxCount: 10, dmgType: d });
  oneTurn(`${d}_POWER_UP`, `${DMG_LABEL[d]} Power Up`, "positive", "power", `${DMG_LABEL[d]} skills gain Final Power by Count for one turn.`, { dmgType: d });
  oneTurn(`${d}_POWER_DOWN`, `${DMG_LABEL[d]} Power Down`, "negative", "power", `${DMG_LABEL[d]} skills lose Final Power by Count for one turn.`, { dmgType: d });
  oneTurn(`${d}_PROTECTION`, `${DMG_LABEL[d]} Protection`, "positive", "defense", `Take 10% less damage from ${DMG_LABEL[d]} skills per Count for one turn. (Max 10)`, { maxCount: 10, dmgType: d });
  oneTurn(`${d}_FRAGILITY`, `${DMG_LABEL[d]} Fragility`, "negative", "defense", `Take +10% damage from ${DMG_LABEL[d]} skills per Count for one turn. (Max 10)`, { maxCount: 10, dmgType: d });
  oneTurn(`${d}_RESIST_DOWN`, `${DMG_LABEL[d]} Resist Down`, "negative", "resist", `${DMG_LABEL[d]} Resistance +0.1 per Count for one turn (more damage taken).`, { dmgType: d });
}
for (const s of SINS) {
  oneTurn(`${s}_DMG_UP`, `${SIN_LABEL[s]} DMG Up`, "positive", "damage", `Deal +10% damage with ${SIN_LABEL[s]} skills per Count for one turn. (Max 10)`, { maxCount: 10, sinFilter: s });
  oneTurn(`${s}_DMG_DOWN`, `${SIN_LABEL[s]} DMG Down`, "negative", "damage", `Deal 10% less damage with ${SIN_LABEL[s]} skills per Count for one turn. (Max 10)`, { maxCount: 10, sinFilter: s });
  oneTurn(`${s}_POWER_UP`, `${SIN_LABEL[s]} Power Up`, "positive", "power", `${SIN_LABEL[s]} skills gain Final Power by Count for one turn.`, { sinFilter: s });
  oneTurn(`${s}_POWER_DOWN`, `${SIN_LABEL[s]} Power Down`, "negative", "power", `${SIN_LABEL[s]} skills lose Final Power by Count for one turn.`, { sinFilter: s });
  oneTurn(`${s}_PROTECTION`, `${SIN_LABEL[s]} Protection`, "positive", "defense", `Take 10% less damage from ${SIN_LABEL[s]} skills per Count for one turn. (Max 10)`, { maxCount: 10, sinFilter: s });
  oneTurn(`${s}_FRAGILITY`, `${SIN_LABEL[s]} Fragility`, "negative", "defense", `Take +10% damage from ${SIN_LABEL[s]} skills per Count for one turn. (Max 10)`, { maxCount: 10, sinFilter: s });
  oneTurn(`${s}_RESIST_DOWN`, `${SIN_LABEL[s]} Resist Down`, "negative", "resist", `${SIN_LABEL[s]} Resistance +0.1 per Count for one turn (more damage taken).`, { sinFilter: s });
}

// ---- Longer-lasting extras ------------------------------------------------------------
add({ key: "POISON", name: "Poison", polarity: "negative", mode: "value", oneTurn: false, group: "other",
  description: "Turn End: take fixed damage equal to Count, then halve Count (rounded down)." });
add({ key: "NAILS", name: "Nails", polarity: "negative", mode: "value", oneTurn: false, group: "keyword", countsAs: "BLEED",
  description: "Unique Bleed. Turn Start: gain 1 Bleed and +Count Bleed Count. Turn End: halve Count (rounded down)." });
add({ key: "AGGRO", name: "Aggro", polarity: "neutral", mode: "value", oneTurn: true, group: "other",
  description: "Enemies are more likely to target this unit's slots this turn." });
add({ key: "AMMO", name: "Ammo", polarity: "neutral", mode: "value", oneTurn: false, group: "other",
  description: "Spent by certain skills. Some attacks cancel if lacking Ammo." });

export const BUILTIN_STATUSES: Record<string, StatusDef> = Object.fromEntries(defs.map((d) => [d.key, d]));
export const BUILTIN_STATUS_LIST: StatusDef[] = defs;

export const KEYWORD_STATUSES = ["BURN", "BLEED", "TREMOR", "RUPTURE", "SINKING", "POISE", "CHARGE"] as const;

/** Tremor variants (Tremor page). A unit's Tremor can carry several at once (Superposition). */
export const TREMOR_TYPES = ["DECAY", "FRACTURE", "REVERB", "EVERLASTING", "CHAIN", "SCORCH", "HEMORRHAGE"] as const;
export type TremorType = (typeof TREMOR_TYPES)[number];
export const TREMOR_TYPE_INFO: Record<TremorType, { name: string; description: string }> = {
  DECAY: { name: "Tremor - Decay", description: "Lose 1 Defense Level for every 4 Tremor Potency." },
  FRACTURE: { name: "Tremor - Fracture", description: "When Staggered and Tremor Potency + Count is 20+, raise Stagger Level by 1." },
  REVERB: { name: "Tremor - Reverb", description: "On Tremor Burst, take Sloth damage equal to Tremor Potency." },
  EVERLASTING: { name: "Tremor - Everlasting", description: "On Tremor Burst: Potency% and Count% chances (max 50% each) to Burst again. Extra Bursts do not lower Count." },
  CHAIN: { name: "Tremor - Chain", description: "Lose 1 Clash Power for every 10 Tremor Potency (max 3)." },
  SCORCH: { name: "Tremor - Scorch", description: "On Tremor Burst, take Wrath damage equal to (Tremor Potency + Burn Potency) / 2 and lose 1 Burn Count." },
  HEMORRHAGE: { name: "Tremor - Hemorrhage", description: "On Tremor Burst, take Lust damage equal to (Tremor Potency + Bleed Potency) / 2 and lose 1 Bleed Count." },
};

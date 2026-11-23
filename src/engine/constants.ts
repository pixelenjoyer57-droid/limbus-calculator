// Shared game constants. Values and limits come from the Limbus Company wiki
// (limbuscompany.wiki.gg): Damage Formula, Battles, Skills, Sanity, Sin
// Resonance, Offense Level & Defense Level and the status effect pages.

export const SINS = ["WRATH", "LUST", "SLOTH", "GLUTTONY", "GLOOM", "PRIDE", "ENVY"] as const;
export type Sin = (typeof SINS)[number];

export const SIN_LABEL: Record<Sin, string> = {
  WRATH: "Wrath",
  LUST: "Lust",
  SLOTH: "Sloth",
  GLUTTONY: "Gluttony",
  GLOOM: "Gloom",
  PRIDE: "Pride",
  ENVY: "Envy",
};

/** Colours are only ever shown next to a text label, never on their own. */
export const SIN_COLOR: Record<Sin, string> = {
  WRATH: "#e0413f",
  LUST: "#f0832e",
  SLOTH: "#e3b23c",
  GLUTTONY: "#8cbf3f",
  GLOOM: "#3fb3d9",
  PRIDE: "#5b74e0",
  ENVY: "#a865d8",
};

export const DMG_TYPES = ["SLASH", "PIERCE", "BLUNT"] as const;
export type DmgType = (typeof DMG_TYPES)[number];
export const DMG_LABEL: Record<DmgType, string> = { SLASH: "Slash", PIERCE: "Pierce", BLUNT: "Blunt" };

export const SINNERS = [
  "Yi Sang",
  "Faust",
  "Don Quixote",
  "Ryōshū",
  "Meursault",
  "Hong Lu",
  "Heathcliff",
  "Ishmael",
  "Rodion",
  "Sinclair",
  "Outis",
  "Gregor",
] as const;
export type Sinner = (typeof SINNERS)[number];

export const EGO_GRADES = ["ZAYIN", "TETH", "HE", "WAW", "ALEPH"] as const;
export type EgoGrade = (typeof EGO_GRADES)[number];

export const GIFT_TIERS = ["I", "II", "III", "IV", "V", "EX"] as const;
export type GiftTier = (typeof GIFT_TIERS)[number];

export const RARITY_LABEL: Record<number, string> = { 1: "0", 2: "00", 3: "000" };

/** Named resistance tiers (Battles page). Values are the multiplier shown in game. */
export const RESIST_PRESETS: { value: number; label: string }[] = [
  { value: 2, label: "Fatal ×2" },
  { value: 1.5, label: "Weak ×1.5" },
  { value: 1.25, label: "Weak ×1.25" },
  { value: 1, label: "Normal ×1" },
  { value: 0.75, label: "Endure ×0.75" },
  { value: 0.5, label: "Ineff. ×0.5" },
  { value: 0.25, label: "Ineff. ×0.25" },
  { value: 0, label: "Immune ×0" },
];

export function resistTierName(x: number): string {
  if (x <= 0) return "Immune";
  if (x < 0.75) return "Ineff.";
  if (x < 1) return "Endure";
  if (x === 1) return "Normal";
  if (x <= 1.5) return "Weak";
  return "Fatal";
}

/** Limits the game itself enforces or that real kits stay inside. Used for warnings. */
export const LIMITS = {
  sp: { min: -45, max: 45 },
  statusMax: 99,
  oneTurnMax: 10, // Fragile, Protection, Damage Up ... "(Max 10)"
  chargeCountMax: 20,
  levelMod: { min: -8, max: 6 }, // "Skills and E.G.O can also have a modifier that ranges from +6 to -8"
  coins: { min: 1, max: 5, egoMax: 8 },
  basePower: { min: 0, max: 40 },
  coinPower: { min: -15, max: 20 },
  atkWeight: { min: 1, max: 7 },
  speed: { min: 1, max: 20 },
  staggerThresholds: { sinnerMax: 3 },
  clashCountMax: 99, // "At 99 clash count, the clash will end and both skills will not be used."
  turnsMax: 99, // 100+ turns triggers OverClock (defeat)
  maxLevel: 65,
};

export const DEFAULT_DECK_AMOUNT = { S1: 3, S2: 2, S3: 1 } as const;

/**
 * Sin Resonance Offense/Defense Level bonus (Sin Resonance page).
 * RESONANCE_BONUS[i] = bonus for the skill at position i+1 in the chain.
 * ABSOLUTE_RESONANCE_BONUS[n-1] = bonus for every skill of an n-long contiguous chain.
 */
export const RESONANCE_BONUS = [0, 1, 3, 3, 5, 5, 7, 7, 9, 9, 11, 11];
export const ABSOLUTE_RESONANCE_BONUS = [0, 0, 3, 5, 5, 7, 7, 9, 9, 11, 11, 13];

/** E.G.O corrosion chance by SP after paying the E.G.O cost (E.G.O/Gameplay page). */
export function corrosionChance(spAfter: number): number {
  if (spAfter <= -45) return 1;
  if (spAfter <= -34) return 0.75;
  if (spAfter <= -23) return 0.25;
  return 0;
}

export const EGO_GRADE_COLOR: Record<EgoGrade, string> = {
  ZAYIN: "#36d65a",
  TETH: "#3aa2ff",
  HE: "#f3e43a",
  WAW: "#9a5cf0",
  ALEPH: "#ff4040",
};

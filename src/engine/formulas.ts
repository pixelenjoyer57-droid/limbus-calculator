// Pure combat formulas, each taken from the Limbus Company wiki.
// Every function here is covered by tests/formulas.test.ts.
import { ABSOLUTE_RESONANCE_BONUS, LIMITS, RESONANCE_BONUS } from "./constants";

/**
 * Resistance -> static damage modifier (Damage Formula page, "Sin Resistances").
 *   x < 0      -> -0.5   (Immune [x0] only halves damage)
 *   0 <= x < 1 -> (x - 1) / 2
 *   x >= 1     -> x - 1
 */
export function resistMod(x: number): number {
  if (x <= 0) return -0.5;
  if (x < 1) return (x - 1) / 2;
  return x - 1;
}

/**
 * Damage type (Slash/Pierce/Blunt) modifier. While Staggered the resistance is
 * replaced by a flat +1 / +1.5 / +2 for Stagger / Stagger+ / Stagger++.
 */
export function physResistMod(x: number, staggerLevel: number): number {
  if (staggerLevel > 0) return 0.5 + 0.5 * Math.min(3, staggerLevel);
  return resistMod(x);
}

/** Resistances cannot exceed x2 (without Stagger) nor go below x0 (Battles page). */
export function clampResist(x: number): number {
  return Math.max(0, Math.min(2, x));
}

/** Offense/Defense Level advantage: (Off - Def) / (|Off - Def| + 25). */
export function levelAdvantage(off: number, def: number): number {
  const d = off - def;
  return d / (Math.abs(d) + 25);
}

/** "The Skill with higher Level gains 1 Power per 3 Level difference, rounded down." */
export function levelClashBonus(myLevel: number, theirLevel: number): number {
  const d = myLevel - theirLevel;
  return d > 0 ? Math.floor(d / 3) : 0;
}

/** Heads chance: 50 + SP (%). Units without Sanity always flip at 50%. */
export function headsChance(sp: number, hasSanity: boolean, bonusPct = 0): number {
  const base = hasSanity ? 50 + Math.max(LIMITS.sp.min, Math.min(LIMITS.sp.max, sp)) : 50;
  return Math.max(0, Math.min(100, base + bonusPct)) / 100;
}

/** Critical Hit static modifier: (0.2 + static crit mods) x (1 + static crit mult mods). */
export function critModifier(staticCritMods = 0, staticCritMult = 0): number {
  return (0.2 + staticCritMods) * (1 + staticCritMult);
}

/** Crit chance from Poise Potency: Potency x 5%, capped at 100%. */
export function poiseCritChance(potency: number): number {
  return Math.max(0, Math.min(1, potency * 0.05));
}

/** Each Clash count adds +3% (static). */
export function clashCountMod(clashCount: number): number {
  return Math.max(0, Math.min(98, clashCount)) * 0.03;
}

export interface DamageInput {
  coinRoll: number;
  staticParts: { label: string; value: number }[];
  dynamicParts: { label: string; value: number }[];
}

export interface DamageResult {
  coinRoll: number;
  staticTotal: number;
  dynamicTotal: number;
  raw: number;
  final: number;
  floorApplied: "none" | "fivePercent" | "minimumOne";
}

/**
 * Final Damage = floor( Coin Roll x (1 + Static) x (1 + Dynamic) )
 *  - If below 5% of the Coin Roll, it becomes 5% of the Coin Roll.
 *  - It is rounded down and can never be below 1.
 */
export function finalDamage(input: DamageInput): DamageResult {
  const coinRoll = Math.max(0, input.coinRoll);
  const staticTotal = input.staticParts.reduce((a, p) => a + p.value, 0);
  const dynamicTotal = input.dynamicParts.reduce((a, p) => a + p.value, 0);
  let raw = coinRoll * (1 + staticTotal) * (1 + dynamicTotal);
  let floorApplied: DamageResult["floorApplied"] = "none";
  const minFive = 0.05 * coinRoll;
  if (raw < minFive) {
    raw = minFive;
    floorApplied = "fivePercent";
  }
  // tiny epsilon so 0.1+0.2 style float noise never costs a point of damage
  let final = Math.floor(raw + 1e-9);
  if (final < 1) {
    final = 1;
    floorApplied = "minimumOne";
  }
  return { coinRoll, staticTotal, dynamicTotal, raw, final, floorApplied };
}

/** Clashable Guard loss: the winner's roll drops by the guard's power, to at least max(floor(5% roll), 1). */
export function guardReducedRoll(coinRoll: number, guardPower: number): number {
  const floor = Math.max(Math.floor(0.05 * coinRoll), 1);
  return Math.max(coinRoll - guardPower, Math.min(coinRoll, floor));
}

/**
 * SP gained after winning a Clash (current base factor):
 * "Base Value is 10, raised by 20% per Clash count after 1" -> 10 + 2 x (count - 1).
 */
export function clashWinSp(clashCount: number): number {
  return Math.floor(10 * (1 + 0.2 * Math.max(0, clashCount - 1)) + 1e-9);
}

/** SP lost when an ally of the same or higher level dies: 10, raised by 10 per level of difference. */
export function allyDeathSp(deadLevel: number, myLevel: number): number {
  if (deadLevel < myLevel) return 0;
  return 10 + 10 * (deadLevel - myLevel);
}

/** Overclocking costs 1.5x resources and SP, rounded up. */
export function overclockCost(n: number): number {
  return Math.ceil(n * 1.5 - 1e-9);
}

/** Resonance bonus for the skill at 1-based `position` in a same-sin chain. */
export function resonanceBonus(position: number): number {
  if (position <= 0) return 0;
  return RESONANCE_BONUS[Math.min(position, RESONANCE_BONUS.length) - 1];
}

/** Absolute Resonance bonus for every skill in a contiguous chain of `length` skills. */
export function absoluteResonanceBonus(length: number): number {
  if (length < 3) return 0;
  return ABSOLUTE_RESONANCE_BONUS[Math.min(length, ABSOLUTE_RESONANCE_BONUS.length) - 1];
}

/** HP at a level: HP = Base + Mult x Level (Battles page). Stats are authored at `refLevel`. */
export function hpAtLevel(hpAtRef: number, perLevel: number, refLevel: number, level: number): number {
  return Math.max(1, Math.round(hpAtRef + perLevel * (level - refLevel)));
}

/** Probability that a Binomial(n, p) draw is >= k. Used for event checks and forecasts. */
export function binomAtLeast(n: number, p: number, k: number): number {
  if (k <= 0) return 1;
  if (k > n) return 0;
  let total = 0;
  for (let i = k; i <= n; i++) total += binomPmf(n, p, i);
  return Math.min(1, total);
}

export function binomPmf(n: number, p: number, k: number): number {
  return choose(n, k) * Math.pow(p, k) * Math.pow(1 - p, n - k);
}

function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

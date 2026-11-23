// Exact Clash odds for skills without conditional effects, by dynamic programming
// over how many coins each side still has. Coins are lost from the front, so the
// coins still in play are always the last ones. Supports custom coins: each coin can
// have its own Heads chance, Coin Power, or multiply the power on Heads.
import type { CoinType, Skill } from "../data/schema";

export interface CoinSpec {
  p: number; // chance to land Heads (0..1)
  op: "add" | "multiply";
  value: number; // Coin Power, or the multiplier for multiply coins
}

export interface ClashSide {
  base: number;
  /** Either a list of coins, or a count of identical coins (with coinPower and p). */
  coins: number | CoinSpec[];
  coinPower?: number;
  p?: number;
  bonus: number; // flat Clash Power bonus (level difference, Clash Power Up ...)
  finalBonus?: number; // Power Up style bonus added before the Clash bonus
}

export interface ClashOdds {
  win: number;
  lose: number;
  /** Distribution of the winner's remaining coins: index = coins left. */
  aRemaining: number[];
  bRemaining: number[];
  firstRoundWin: number;
  expectedRounds: number;
}

export function specsOf(s: ClashSide): CoinSpec[] {
  if (Array.isArray(s.coins)) return s.coins;
  return Array.from({ length: Math.max(0, s.coins) }, () => ({ p: s.p ?? 0.5, op: "add" as const, value: s.coinPower ?? 0 }));
}

/** Distribution of a skill's power for a set of coins: (Base + Heads adds) × Heads multipliers. */
export function powerDist(base: number, coins: CoinSpec[], finalBonus = 0): Map<number, number> {
  let states = new Map<string, { add: number; mul: number; p: number }>();
  states.set("0|1", { add: 0, mul: 1, p: 1 });
  for (const c of coins) {
    const next = new Map<string, { add: number; mul: number; p: number }>();
    const put = (add: number, mul: number, p: number) => {
      if (p <= 0) return;
      const k = `${add}|${mul}`;
      const cur = next.get(k);
      if (cur) cur.p += p;
      else next.set(k, { add, mul, p });
    };
    for (const st of states.values()) {
      if (c.op === "multiply") put(st.add, st.mul * c.value, st.p * c.p);
      else put(st.add + c.value, st.mul, st.p * c.p);
      put(st.add, st.mul, st.p * (1 - c.p));
    }
    states = next;
  }
  const out = new Map<number, number>();
  for (const st of states.values()) {
    const power = Math.max(0, Math.floor((base + st.add) * st.mul + 1e-9) + finalBonus);
    out.set(power, (out.get(power) ?? 0) + st.p);
  }
  return out;
}

function roundOutcome(da: Map<number, number>, bonusA: number, db: Map<number, number>, bonusB: number) {
  let w = 0, l = 0, t = 0;
  for (const [pa, qa] of da) {
    for (const [pb, qb] of db) {
      const x = pa + bonusA, y = pb + bonusB;
      const pr = qa * qb;
      if (x > y) w += pr;
      else if (x < y) l += pr;
      else t += pr;
    }
  }
  return { w, l, t };
}

export function clashOdds(a: ClashSide, b: ClashSide): ClashOdds {
  const sa = specsOf(a), sb = specsOf(b);
  const n = sa.length, m = sb.length;
  const distA = Array.from({ length: n + 1 }, (_, i) => (i ? powerDist(a.base, sa.slice(n - i), a.finalBonus ?? 0) : new Map()));
  const distB = Array.from({ length: m + 1 }, (_, j) => (j ? powerDist(b.base, sb.slice(m - j), b.finalBonus ?? 0) : new Map()));
  const reach: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  reach[n][m] = 1;
  const aRemaining = new Array(n + 1).fill(0);
  const bRemaining = new Array(m + 1).fill(0);
  let firstRoundWin = 0;
  let expectedRounds = 0;
  for (let total = n + m; total >= 1; total--) {
    for (let i = n; i >= 0; i--) {
      const j = total - i;
      if (j < 0 || j > m) continue;
      const pr = reach[i][j];
      if (pr === 0 || i === 0 || j === 0) continue;
      const { w, l } = roundOutcome(distA[i], a.bonus, distB[j], b.bonus);
      if (i === n && j === m) firstRoundWin = w;
      const leave = w + l;
      if (leave <= 1e-12) continue; // perpetual tie: both skills are cancelled at 99 Clash count
      expectedRounds += pr * (1 / leave);
      reach[i][j - 1] += pr * (w / leave);
      reach[i - 1][j] += pr * (l / leave);
    }
  }
  let win = 0, lose = 0;
  for (let i = 1; i <= n; i++) {
    aRemaining[i] = reach[i][0];
    win += reach[i][0];
  }
  for (let j = 1; j <= m; j++) {
    bRemaining[j] = reach[0][j];
    lose += reach[0][j];
  }
  return { win, lose, aRemaining, bRemaining, firstRoundWin, expectedRounds };
}

/** Static view of a skill's coins (custom coin types applied), for odds and previews. */
export function staticCoins(skill: Pick<Skill, "coins" | "coinPower">, p: number, coinTypes: Record<string, CoinType> = {}): CoinSpec[] {
  return skill.coins.map((c) => {
    const t = c.customType ? coinTypes[c.customType] : undefined;
    const op = c.op ?? t?.op ?? "add";
    const fixed = c.fixed ?? (t && t.fixed !== "none" ? t.fixed : null);
    const pc = fixed === "heads" ? 1 : fixed === "tails" ? 0 : Math.max(0, Math.min(1, p + (c.headsBonus + (t?.headsBonus ?? 0)) / 100));
    const value = op === "multiply" ? (c.mult ?? t?.mult ?? 2) : (c.power ?? t?.power ?? skill.coinPower);
    return { p: pc, op, value };
  });
}

/** Lowest and highest Final Power a skill can roll (all coin results considered). */
export function skillPowerRange(skill: Skill, coinTypes: Record<string, CoinType> = {}): { min: number; max: number } {
  const coins = staticCoins(skill, 0.5, coinTypes).map((c) => ({ ...c, p: c.p === 1 || c.p === 0 ? c.p : 0.5 }));
  const dist = powerDist(skill.basePower, coins);
  const values = [...dist.keys()];
  return { min: Math.min(...values), max: Math.max(...values) };
}

/** Old helper kept for simple skills: Base + Coin Power × coins. */
export function powerRange(base: number, coinPower: number, coins: number): { min: number; max: number } {
  const all = base + coinPower * coins;
  return { min: Math.max(0, Math.min(base, all)), max: Math.max(0, Math.max(base, all)) };
}

export function expectedPower(dist: Map<number, number>): number {
  let e = 0;
  for (const [v, p] of dist) e += v * p;
  return e;
}

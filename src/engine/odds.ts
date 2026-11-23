// Exact Clash odds for "static" skills (no conditional effects), by dynamic
// programming over the number of coins each side still has. Used for the
// planning forecast, the auto-planner and the calculator's quick estimate.
import { binomPmf } from "./formulas";

export interface ClashSide {
  base: number;
  coinPower: number;
  coins: number;
  p: number; // heads chance 0..1
  bonus: number; // flat clash power bonus (level difference, Clash Power Up ...)
  finalBonus?: number; // Power Up style bonus added before the clash bonus
}

export interface ClashOdds {
  win: number;
  lose: number;
  /** Distribution of the winner's remaining coins when A wins: index = coins left. */
  aRemaining: number[];
  bRemaining: number[];
  firstRoundWin: number;
  expectedRounds: number;
}

function roundOutcome(a: ClashSide, ai: number, b: ClashSide, bj: number) {
  let w = 0, l = 0, t = 0;
  for (let x = 0; x <= ai; x++) {
    const px = binomPmf(ai, a.p, x);
    if (px === 0) continue;
    const pa = Math.max(0, a.base + a.coinPower * x + (a.finalBonus ?? 0)) + a.bonus;
    for (let y = 0; y <= bj; y++) {
      const py = binomPmf(bj, b.p, y);
      if (py === 0) continue;
      const pb = Math.max(0, b.base + b.coinPower * y + (b.finalBonus ?? 0)) + b.bonus;
      const pr = px * py;
      if (pa > pb) w += pr;
      else if (pa < pb) l += pr;
      else t += pr;
    }
  }
  return { w, l, t };
}

export function clashOdds(a: ClashSide, b: ClashSide): ClashOdds {
  const n = Math.max(0, a.coins), m = Math.max(0, b.coins);
  // P[i][j] = probability of ever reaching state (i, j) from (n, m)
  const reach: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  reach[n][m] = 1;
  const aRemaining = new Array(n + 1).fill(0);
  const bRemaining = new Array(m + 1).fill(0);
  let firstRoundWin = 0;
  let expectedRounds = 0;
  // process states in order of decreasing total coins
  for (let total = n + m; total >= 1; total--) {
    for (let i = n; i >= 0; i--) {
      const j = total - i;
      if (j < 0 || j > m) continue;
      const pr = reach[i][j];
      if (pr === 0 || i === 0 || j === 0) continue;
      const { w, l } = roundOutcome(a, i, b, j);
      if (i === n && j === m) firstRoundWin = w;
      const leave = w + l;
      if (leave <= 1e-12) {
        // perpetual tie: both skills cancel at 99 Clash count
        continue;
      }
      const ew = w / leave, el = l / leave;
      // expected rounds spent in this state = 1 / leave (geometric)
      expectedRounds += pr * (1 / leave);
      reach[i][j - 1] += pr * ew;
      reach[i - 1][j] += pr * el;
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

/** Expected Final Power of each coin when attacking unopposed (no effects). */
export function expectedCoinRolls(base: number, coinPower: number, coins: number, p: number, finalBonus = 0): number[] {
  const out: number[] = [];
  for (let k = 1; k <= coins; k++) {
    // E[max(0, base + cp * H_k)] with H_k ~ Bin(k, p)
    let e = 0;
    for (let h = 0; h <= k; h++) e += binomPmf(k, p, h) * Math.max(0, base + coinPower * h + finalBonus);
    out.push(e);
  }
  return out;
}

export function powerRange(base: number, coinPower: number, coins: number): { min: number; max: number } {
  const all = base + coinPower * coins;
  return { min: Math.max(0, Math.min(base, all)), max: Math.max(0, Math.max(base, all)) };
}

// Many full battles in a row (auto-played) for win rates and averages.
import { createBattle, type BattleSetup } from "./setup";
import { runToEnd } from "./turn";

export interface BatchOptions {
  runs: number;
  maxTurns: number;
  useEgo: boolean;
  seed: number;
}

export interface BatchUnitStats {
  name: string;
  side: "ally" | "enemy";
  avgDamageDealt: number;
  avgStatusDamage: number;
  avgDamageTaken: number;
  survival: number;
  avgClashWinRate: number;
}

export interface BatchResult {
  runs: number;
  wins: number;
  avgTurns: number;
  avgTurnsWin: number;
  turnHistogram: { turn: number; wins: number; losses: number }[];
  units: BatchUnitStats[];
  warnings: string[];
}

export function runBatch(setup: BattleSetup, opts: BatchOptions, onProgress?: (done: number) => void): BatchResult {
  const runs = Math.max(1, Math.min(5000, opts.runs));
  let wins = 0;
  let turns = 0;
  let turnsWin = 0;
  const hist = new Map<number, { wins: number; losses: number }>();
  const agg = new Map<string, { name: string; side: "ally" | "enemy"; dealt: number; status: number; taken: number; alive: number; won: number; lost: number; n: number }>();
  let warnings: string[] = [];
  for (let i = 0; i < runs; i++) {
    const { battle, warnings: w } = createBattle({ ...setup, seed: (opts.seed + i * 2654435761) >>> 0, settings: { ...setup.settings, logDetail: "none" } });
    if (i === 0) warnings = w;
    runToEnd(battle, opts.maxTurns, opts.useEgo);
    const won = battle.outcome === "win";
    if (won) {
      wins++;
      turnsWin += battle.turn;
    }
    turns += battle.turn;
    const h = hist.get(battle.turn) ?? { wins: 0, losses: 0 };
    if (won) h.wins++;
    else h.losses++;
    hist.set(battle.turn, h);
    for (const [uid, s] of Object.entries(battle.stats)) {
      const a = agg.get(uid) ?? { name: s.name, side: s.side, dealt: 0, status: 0, taken: 0, alive: 0, won: 0, lost: 0, n: 0 };
      a.dealt += s.damageDealt;
      a.status += s.statusDamageDealt;
      a.taken += s.damageTaken;
      a.alive += s.alive ? 1 : 0;
      a.won += s.clashesWon;
      a.lost += s.clashesLost;
      a.n += 1;
      agg.set(uid, a);
    }
    if (onProgress && i % 25 === 0) onProgress(i);
  }
  const units: BatchUnitStats[] = [...agg.values()].map((a) => ({
    name: a.name,
    side: a.side,
    avgDamageDealt: a.dealt / a.n,
    avgStatusDamage: a.status / a.n,
    avgDamageTaken: a.taken / a.n,
    survival: a.alive / a.n,
    avgClashWinRate: a.won + a.lost ? a.won / (a.won + a.lost) : 0,
  }));
  return {
    runs,
    wins,
    avgTurns: turns / runs,
    avgTurnsWin: wins ? turnsWin / wins : 0,
    turnHistogram: [...hist.entries()].sort((a, b) => a[0] - b[0]).map(([turn, v]) => ({ turn, ...v })),
    units,
    warnings,
  };
}

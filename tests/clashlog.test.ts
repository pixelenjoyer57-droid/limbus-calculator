import { describe, expect, it } from "vitest";
import { sampleWorkspace } from "../src/data/defaults";
import { createBattle } from "../src/engine/setup";
import { runToEnd } from "../src/engine/turn";
import type { LogEntry } from "../src/engine/types";

function fight(logDetail: "full" | "summary" | "none"): LogEntry[] {
  const ws = sampleWorkspace();
  const all: LogEntry[] = [];
  for (const enc of ws.encounters) {
    for (let seed = 1; seed <= 4; seed++) {
      const { battle } = createBattle({ workspace: ws, team: ws.teams[0], encounterId: enc.id, seed });
      battle.settings.logDetail = logDetail;
      runToEnd(battle, 20);
      all.push(...battle.log);
    }
  }
  return all;
}

describe("structured clash log", () => {
  for (const mode of ["full", "summary"] as const) {
    it(`records rounds, coins, winner and totals (${mode})`, () => {
      const entries = fight(mode).filter((e) => e.clash);
      expect(entries.length).toBeGreaterThan(0);
      const wins = entries.filter((e) => e.clash!.outcome === "win");
      expect(wins.length).toBeGreaterThan(0);
      for (const e of wins) {
        const c = e.clash!;
        expect(c.rounds.length).toBeGreaterThan(0);
        expect(c.winner === "a" || c.winner === "b").toBe(true);
        for (const r of c.rounds) {
          for (const [x, info] of [[r.a, c.a], [r.b, c.b]] as const) {
            expect(x.coins.length).toBeGreaterThan(0);
            expect(x.coins.length).toBeLessThanOrEqual(info.coins);
            expect(x.coins).toMatch(/^[HTP]+$/);
            const sum = Math.floor((x.base + x.coinAdd) * x.mult + 1e-9) + x.finalPower + x.clashMods.reduce((s, m) => s + m.value, 0);
            expect(x.total).toBe(Math.max(0, sum));
          }
        }
      }
    });
  }
  it("logs no clash entries in none mode", () => {
    expect(fight("none").filter((e) => e.kind === "clash").length).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import { emptyWorkspace, newEnemy, newIdentity, newTeam } from "../src/data/defaults";
import { createBattle } from "../src/engine/setup";
import { endTurn } from "../src/engine/turn";
import { groupTargets } from "../src/features/sim/Battlefield";
import type { Enemy } from "../src/data/schema";
import type { BattleState } from "../src/engine/types";

function fight(foe: Enemy, slots?: number) {
  const ws = emptyWorkspace();
  const idn = newIdentity({ name: "Tester", level: 45 });
  ws.identities.push(idn);
  ws.enemies.push(foe);
  const team = { ...newTeam(), members: { "Yi Sang": { identityId: idn.id, level: 45, uptie: 4, egos: { ZAYIN: null, TETH: null, HE: null, WAW: null, ALEPH: null } } }, deploy: ["Yi Sang" as const] };
  const { battle } = createBattle({ workspace: ws, team, enemies: [{ enemyId: foe.id, level: 0, count: 1, slots }], seed: 1 });
  return battle;
}
const slotsOf = (b: BattleState) => b.units.filter((u) => u.side === "enemy" && u.kind !== "core").map((u) => u.slots);

describe("enemy slot override", () => {
  const abno = () =>
    newEnemy({ name: "Abno", parts: [{ name: "Head", hp: 100, slots: 1 }, { name: "Body", hp: 100, slots: 1 }] as never });
  it("Abnormality Parts get the override on turn 1 and keep it", () => {
    const b = fight(abno(), 2);
    expect(slotsOf(b)).toEqual([2, 2]);
    endTurn(b);
    expect(slotsOf(b)).toEqual([2, 2]);
  });
  it("0 keeps the Part's own slots", () => {
    expect(slotsOf(fight(abno(), 0))).toEqual([1, 1]);
    expect(slotsOf(fight(abno()))).toEqual([1, 1]);
  });
  it("a normal enemy grows 1 -> 2 -> 3 and stops at the override", () => {
    const foe = () => newEnemy({ name: "Grunt", slots: 1, slotsMax: 1 });
    const b = fight(foe(), 3);
    const seen = [slotsOf(b)[0]];
    for (let i = 0; i < 4; i++) {
      endTurn(b);
      seen.push(slotsOf(b)[0]);
    }
    expect(seen).toEqual([1, 2, 3, 3, 3]);
    expect(slotsOf(fight(foe(), 0))).toEqual([1]);
  });
  it("an override below the starting slots lowers the start", () => {
    expect(slotsOf(fight(newEnemy({ name: "Big", slots: 3, slotsMax: 3 }), 2))).toEqual([2]);
  });
});

describe("board target lines", () => {
  it("groups consecutive slots with the same target and caps at 3 lines", () => {
    const mk = (slot: number, target: string) => ({ id: `a${slot}`, uid: "x", slot, skill: "k", target, targetAction: null, side: "enemy" }) as never;
    const b = { plan: [], units: [{ uid: "p", name: "Body" }, { uid: "q", name: "Head" }] } as unknown as BattleState;
    const ten = Array.from({ length: 10 }, (_, i) => mk(i, "p"));
    expect(groupTargets(b, ten, true).map((l) => l.text)).toEqual(["1–10: → Body"]);
    const alt = [mk(0, "p"), mk(1, "q"), mk(2, "p"), mk(3, "q"), mk(4, "p")];
    expect(groupTargets(b, alt, true).map((l) => l.text)).toEqual(["1: → Body", "2: → Head", "3: → Body", "+2 more"]);
  });
});

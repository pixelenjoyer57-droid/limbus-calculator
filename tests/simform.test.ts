import { describe, expect, it } from "vitest";
import { healSimForm } from "../src/features/sim/form";
import type { Workspace } from "../src/data/schema";
import type { SimForm } from "../src/store/session";

const ws = { teams: [{ id: "t1" }, { id: "t2" }], encounters: [{ id: "e1" }], enemies: [{ id: "en1" }] } as unknown as Workspace;
const base: SimForm = { teamId: "t2", source: "encounter", encounterId: "e1", quick: [], skillMode: "free", runs: 1, maxTurns: 1, useEgo: true };

describe("healSimForm", () => {
  it("keeps a valid form untouched", () => {
    expect(healSimForm(ws, base)).toBe(base);
  });
  it("replaces a stale team with the first team", () => {
    expect(healSimForm(ws, { ...base, teamId: "gone" }).teamId).toBe("t1");
  });
  it("replaces a stale encounter, or falls back to quick pick", () => {
    expect(healSimForm(ws, { ...base, encounterId: "gone" }).encounterId).toBe("e1");
    const none = { ...ws, encounters: [] } as unknown as Workspace;
    const h = healSimForm(none, { ...base, encounterId: "gone" });
    expect(h.source).toBe("quick");
    expect(h.encounterId).toBe("");
  });
  it("drops deleted custom enemies but keeps game enemies", () => {
    const q = [{ enemyId: "gone", level: 0, count: 1 }, { enemyId: "en1", level: 0, count: 1 }, { enemyId: "g:en:5", level: 0, count: 1 }];
    expect(healSimForm(ws, { ...base, source: "quick", quick: q }).quick.map((x) => x.enemyId)).toEqual(["en1", "g:en:5"]);
  });
  it("gives old quick rows a Slots override of 0", () => {
    const q = [{ enemyId: "en1", level: 0, count: 1 }, { enemyId: "en1", level: 0, count: 1, slots: 2 }];
    expect(healSimForm(ws, { ...base, source: "quick", quick: q }).quick.map((x) => x.slots)).toEqual([0, 2]);
  });
});

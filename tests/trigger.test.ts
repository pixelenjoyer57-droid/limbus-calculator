import { describe, expect, it } from "vitest";
import { emptyWorkspace, newEnemy, newIdentity } from "../src/data/defaults";
import { createBattle } from "../src/engine/setup";
import { runAction, type Ctx } from "../src/engine/effects";
import { describeAction } from "../src/engine/describe";
import { addStatus, getStatus } from "../src/engine/state";
import { val, zAction } from "../src/data/schema";
import { convert, type StatusLookup } from "../scripts/gamedata/effects";

function setup() {
  const ws = emptyWorkspace();
  const idn = newIdentity({ name: "Applier", staggerThresholds: [] });
  const foe = newEnemy({ name: "Foe", hp: 900, staggerThresholds: [], skills: [], slots: 0, slotsMax: 0 });
  ws.identities.push(idn);
  ws.enemies.push(foe);
  const team = { ...ws.teams[0], id: "t", kind: "team" as const, name: "T", members: { "Yi Sang": { identityId: idn.id, level: 65, uptie: 4, egos: { ZAYIN: null, TETH: null, HE: null, WAW: null, ALEPH: null } } }, deploy: ["Yi Sang" as const], gifts: [], startResources: { WRATH: 0, LUST: 0, SLOTH: 0, GLUTTONY: 0, GLOOM: 0, PRIDE: 0, ENVY: 0 }, notes: "", tags: [], createdAt: 0, updatedAt: 0 };
  const { battle } = createBattle({ workspace: ws, team, enemies: [{ enemyId: foe.id, level: 0, count: 1 }], seed: 1 });
  const self = battle.units.find((u) => u.side === "ally")!;
  const enemy = battle.units.find((u) => u.side === "enemy")!;
  const ctx: Ctx = { b: battle, self, other: enemy, mainTarget: enemy };
  return { battle, self, enemy, ctx };
}
const trig = (status: string, times = 1, who = "target") => zAction.parse({ kind: "triggerStatus", status, amount: val(times), who });

describe("triggerStatus action", () => {
  it("Burn deals Potency damage and lowers Count by 1", () => {
    const { battle, enemy, ctx } = setup();
    addStatus(battle, enemy, "BURN", 6, 3);
    const hp = enemy.hp;
    runAction(trig("BURN"), ctx, "Test");
    expect(hp - enemy.hp).toBe(6);
    expect(getStatus(enemy, "BURN")?.count).toBe(2);
  });

  it("triggers twice", () => {
    const { battle, enemy, ctx } = setup();
    addStatus(battle, enemy, "BURN", 5, 4);
    const hp = enemy.hp;
    runAction(trig("BURN", 2), ctx, "Test");
    expect(hp - enemy.hp).toBe(10);
    expect(getStatus(enemy, "BURN")?.count).toBe(2);
  });

  it("Tremor trigger raises the Stagger Threshold like Tremor Burst", () => {
    const a = setup();
    const b = setup();
    for (const s of [a, b]) {
      s.enemy.thresholds = [{ pct: 50, hp: 400, triggered: false }];
      addStatus(s.battle, s.enemy, "TREMOR", 7, 3);
    }
    runAction(trig("TREMOR"), a.ctx, "Test");
    runAction(zAction.parse({ kind: "tremorBurst" }), b.ctx, "Test");
    expect(a.enemy.thresholds[0].hp).toBe(b.enemy.thresholds[0].hp);
    expect(a.enemy.thresholds[0].hp).not.toBe(400);
  });

  it("does nothing without the status", () => {
    const { enemy, ctx } = setup();
    const hp = enemy.hp;
    runAction(trig("BURN"), ctx, "Test");
    expect(enemy.hp).toBe(hp);
    expect(enemy.statuses.length).toBe(0);
  });

  it("describes itself", () => {
    expect(describeAction(trig("BURN"))).toBe("Trigger Burn on target");
    expect(describeAction(trig("BLEED", 2, "self"))).toBe("Trigger Bleed on self ×2");
  });
});

describe("wiki converter", () => {
  const lookup: StatusLookup = (name) => ({ key: name.toUpperCase(), mode: "pc" });
  const actionsOf = (text: string) => convert(text, "coin", lookup).effects.flatMap((e) => e.actions);
  it("converts activate/trigger sentences", () => {
    const cases: [string, string, number, string][] = [
      ["Activate ⟦Bleed⟧ on target once", "BLEED", 1, "target"],
      ["Activate the target's ⟦Bleed⟧", "BLEED", 1, "target"],
      ["Trigger ⟦Burn⟧ on target twice", "BURN", 2, "target"],
      ["trigger target's ⟦Rupture⟧", "RUPTURE", 1, "target"],
      ["Activate ⟦Burn⟧ on self", "BURN", 1, "self"],
      ["[On Hit] Activate ⟦Burn⟧ on target 3 times", "BURN", 3, "target"],
    ];
    for (const [text, status, n, who] of cases) {
      const a = actionsOf(text);
      expect(a.length, text).toBe(1);
      expect(a[0].kind).toBe("triggerStatus");
      expect(a[0].status).toBe(status);
      expect(a[0].amount.base).toBe(n);
      expect(a[0].who).toBe(who);
    }
  });
  it("keeps Tremor Burst as its own action", () => {
    const a = actionsOf("Trigger Tremor Burst on target");
    expect(a[0]?.kind).toBe("tremorBurst");
  });
});

import { describe, expect, it } from "vitest";
import { emptyWorkspace, newEnemy, newIdentity, sampleWorkspace } from "../src/data/defaults";
import { act, cond, eff, give, inflict, mod, onCoin, skill } from "../src/data/build";
import { runCalc, type CalcInput, type Combatant } from "../src/engine/calc";
import { createBattle } from "../src/engine/setup";
import { runToEnd, resolveTurn, forecast } from "../src/engine/turn";
import { importAny } from "../src/data/migrate";
import { runBatch } from "../src/engine/batch";
import type { Workspace } from "../src/data/schema";
import { newCoin, val } from "../src/data/schema";

const side = (kind: "identity" | "enemy", id: string, extra: Partial<Combatant> = {}): Combatant => ({
  kind, id, level: 0, uptie: 4, egos: {}, sp: 0, hpPct: 100, stagger: 0, speed: 5, statuses: [], skill: "", part: 0, resonance: 0, ...extra,
});

function setup() {
  const ws = emptyWorkspace();
  const attacker = newIdentity({ name: "Tester", level: 65, hp: 200, hpPerLevel: 0, staggerThresholds: [] });
  attacker.skills[0] = skill("Plain", "WRATH", "SLASH", 4, 4, 2, { amount: 3 });
  const dummy = newEnemy({ name: "Dummy", level: 45, hp: 1000, hasSanity: false, staggerThresholds: [], skills: [], slots: 0, slotsMax: 0 });
  ws.identities.push(attacker);
  ws.enemies.push(dummy);
  return { ws, attacker, dummy };
}

function calc(ws: Workspace, a: Combatant, d: Combatant, exchange: "clash" | "oneSided" = "oneSided", extra: Partial<CalcInput> = {}) {
  return runCalc({ workspace: ws, attacker: a, defender: d, exchange, turnEnd: false, runs: 200, seed: 7, gifts: [], ...extra });
}

describe("one-sided attacks", () => {
  it("matches a hand calculation", () => {
    const { ws, attacker, dummy } = setup();
    const r = calc(ws, side("identity", attacker.id, { skill: "S1" }), side("enemy", dummy.id));
    const heads = r.scenarios.find((s) => s.name === "All Heads, no crit")!;
    // Level 65 vs 45 -> 20/45 = +0.444; coin 1 rolls 8, coin 2 rolls 12 (cumulative)
    expect(heads.hits.map((h) => h.roll)).toEqual([8, 12]);
    expect(heads.hits.map((h) => h.final)).toEqual([11, 17]);
    expect(heads.defenderDamage).toBe(28);
    const tails = r.scenarios.find((s) => s.name === "All Tails")!;
    expect(tails.hits.map((h) => h.final)).toEqual([5, 5]); // floor(4 * 1.444)
  });

  it("adds Damage Up (attacker) and Fragile (target) to the dynamic modifier", () => {
    const { ws, attacker, dummy } = setup();
    const r = calc(
      ws,
      side("identity", attacker.id, { skill: "S1", statuses: [{ key: "DAMAGE_UP", potency: 0, count: 1 }] }),
      side("enemy", dummy.id, { statuses: [{ key: "FRAGILE", potency: 0, count: 2 }] }),
    );
    const heads = r.scenarios.find((s) => s.name === "All Heads, no crit")!;
    expect(heads.hits.map((h) => h.final)).toEqual([15, 22]); // 8*1.444*1.3, 12*1.444*1.3
  });

  it("Poise crits add +20% static and consume Count", () => {
    const { ws, attacker, dummy } = setup();
    const r = calc(ws, side("identity", attacker.id, { skill: "S1", statuses: [{ key: "POISE", potency: 20, count: 5 }] }), side("enemy", dummy.id));
    const heads = r.scenarios.find((s) => s.name === "All Heads")!;
    expect(heads.hits.every((h) => h.crit)).toBe(true);
    expect(heads.hits.map((h) => h.final)).toEqual([13, 19]); // 8*1.644, 12*1.644
  });

  it("Rupture adds fixed damage per hit", () => {
    const { ws, attacker, dummy } = setup();
    const r = calc(ws, side("identity", attacker.id, { skill: "S1" }), side("enemy", dummy.id, { statuses: [{ key: "RUPTURE", potency: 5, count: 2 }] }));
    const heads = r.scenarios.find((s) => s.name === "All Heads, no crit")!;
    expect(heads.defenderDamage).toBe(28 + 10);
  });

  it("Burn inflicted on hit deals its Potency at Turn End", () => {
    const { ws, attacker, dummy } = setup();
    attacker.skills[0] = onCoin(onCoin(skill("Burner", "WRATH", "SLASH", 4, 4, 2), 0, eff("onHit", [inflict("BURN", 2)])), 1, eff("onHit", [inflict("BURN", 2)]));
    const r = calc(ws, side("identity", attacker.id, { skill: "S1" }), side("enemy", dummy.id), "oneSided", { turnEnd: true });
    const heads = r.scenarios.find((s) => s.name === "All Heads, no crit")!;
    expect(heads.defenderDamage).toBe(28 + 4); // 4 Burn Potency, Count 1
  });

  it("conditional skill effects change Base Power", () => {
    const { ws, attacker, dummy } = setup();
    const s = skill("Scaling", "WRATH", "SLASH", 4, 4, 2);
    s.effects.push(eff("onUse", [act("mod", { stat: "basePower", who: "self", amount: { base: 0, per: { q: { kind: "statusPotency", who: "target", status: "BURN", field: "potency", sin: "WRATH" }, q2: null, every: 3, amount: 1 }, min: null, max: 3 } })]));
    attacker.skills[0] = s;
    const r = calc(ws, side("identity", attacker.id, { skill: "S1" }), side("enemy", dummy.id, { statuses: [{ key: "BURN", potency: 7, count: 3 }] }));
    const heads = r.scenarios.find((s2) => s2.name === "All Heads, no crit")!;
    expect(heads.hits.map((h) => h.roll)).toEqual([10, 14]); // +2 Base Power from 7 Burn
  });

  it("passes a Stagger Threshold and the next hits use Stagger resistances", () => {
    const { ws, attacker, dummy } = setup();
    dummy.staggerThresholds = [99];
    attacker.skills[0] = skill("Two hits", "WRATH", "SLASH", 10, 0, 2);
    const r = calc(ws, side("identity", attacker.id, { skill: "S1" }), side("enemy", dummy.id));
    const heads = r.scenarios.find((s) => s.name === "All Heads, no crit")!;
    // 10 * 1.444 = 14, then Staggered: 10 * (1 + 0.444 + 1) = 24
    expect(heads.hits.map((h) => h.final)).toEqual([14, 24]);
    expect(r.defenderStaggered).toBe(1);
  });
});

describe("clashes", () => {
  it("the stronger skill wins every time and gains SP", () => {
    const { ws, attacker } = setup();
    attacker.skills[0] = skill("Big", "WRATH", "SLASH", 10, 0, 1);
    const foe = newEnemy({ name: "Foe", level: 65, hp: 500, staggerThresholds: [], skills: [skill("Small", "ENVY", "BLUNT", 5, 0, 1)] });
    ws.enemies.push(foe);
    const r = calc(ws, side("identity", attacker.id, { skill: "S1" }), side("enemy", foe.id, { skill: "K0" }), "clash");
    expect(r.attackerWin).toBe(1);
    expect(r.damageToAttacker.max).toBe(0);
    // 10 Clash power each round; damage: 10 * (1 + 0 + 0.03 clash count) = 10.3 -> 10
    expect(r.damageToDefender.mean).toBe(10);
    expect(r.scenarios[0].log.some((l) => l.text.includes("gains 10 SP"))).toBe(true);
  });

  it("the losing Unbreakable coins still attack with Coin Power fixed to 1", () => {
    const { ws, attacker } = setup();
    attacker.skills[0] = skill("Weak but stubborn", "WRATH", "SLASH", 2, 3, 2, { coins: [newCoin("unbreakable"), newCoin("unbreakable")] });
    const foe = newEnemy({ name: "Foe", level: 65, hp: 500, staggerThresholds: [], skills: [skill("Wall", "ENVY", "BLUNT", 30, 0, 1)] });
    ws.enemies.push(foe);
    const r = calc(ws, side("identity", attacker.id, { skill: "S1" }), side("enemy", foe.id, { skill: "K0" }), "clash");
    expect(r.defenderWin).toBe(1);
    const best = r.scenarios.find((s) => s.name === "Best case")!;
    // after losing 2 rounds, both cracked coins hit with Coin Power 1: rolls 3 and 4 (+6% clash count)
    const own = best.hits.filter((h) => h.attacker === "Tester");
    expect(own.map((h) => h.roll)).toEqual([3, 4]);
  });

  it("forecast reports a clash when an enemy targets the ally", () => {
    const ws = sampleWorkspace();
    const { battle } = createBattle({ workspace: ws, team: ws.teams[0], encounterId: ws.encounters[0].id, seed: 3 });
    const ally = battle.plan.find((a) => a.side === "ally" && a.targetAction)!;
    expect(["clash", "oneSided"]).toContain(forecast(battle, ally).mode);
  });
});

describe("statuses and effects", () => {
  it("next-turn statuses wait until the next Turn Start", () => {
    const ws = emptyWorkspace();
    const idn = newIdentity({ name: "Applier", staggerThresholds: [] });
    idn.skills = [onCoin(skill("Mark", "WRATH", "SLASH", 4, 0, 1, { amount: 3 }), 0, eff("onHit", [give("FRAGILE", 3, "target", "nextTurn")])), idn.skills[1], idn.skills[2]];
    const foe = newEnemy({ name: "Foe", hp: 900, staggerThresholds: [], skills: [], slots: 0, slotsMax: 0 });
    ws.identities.push(idn);
    ws.enemies.push(foe);
    const team = { ...ws.teams[0], id: "t", kind: "team" as const, name: "T", members: { "Yi Sang": { identityId: idn.id, level: 65, uptie: 4, egos: { ZAYIN: null, TETH: null, HE: null, WAW: null, ALEPH: null } } }, deploy: ["Yi Sang" as const], gifts: [], startResources: { WRATH: 0, LUST: 0, SLOTH: 0, GLUTTONY: 0, GLOOM: 0, PRIDE: 0, ENVY: 0 }, notes: "", tags: [], createdAt: 0, updatedAt: 0 };
    const { battle } = createBattle({ workspace: ws, team, enemies: [{ enemyId: foe.id, level: 0, count: 1 }], seed: 1 });
    const a = battle.plan.find((x) => x.side === "ally")!;
    a.skill = "ally0:S1";
    resolveTurn(battle);
    const enemy = battle.units.find((u) => u.side === "enemy")!;
    expect(enemy.statuses.find((s) => s.key === "FRAGILE")?.count).toBe(3);
  });

  it("always-on passive damage bonuses apply with their condition", () => {
    const { ws, attacker, dummy } = setup();
    attacker.passives = [
      {
        id: "p1", name: "Hunter", kind: "combat", reqMode: "none", reqSin: "WRATH", reqCount: 0, notes: "",
        effects: [eff("always", [mod("dmgDealt", 50)], [cond("hasStatus", { who: "target", status: "BURN" })])],
      },
    ];
    const plain = calc(ws, side("identity", attacker.id, { skill: "S1" }), side("enemy", dummy.id));
    const burning = calc(ws, side("identity", attacker.id, { skill: "S1" }), side("enemy", dummy.id, { statuses: [{ key: "BURN", potency: 1, count: 5 }] }));
    const h1 = plain.scenarios.find((s) => s.name === "All Heads, no crit")!;
    const h2 = burning.scenarios.find((s) => s.name === "All Heads, no crit")!;
    expect(h1.hits.map((h) => h.final)).toEqual([11, 17]);
    expect(h2.hits.map((h) => h.final)).toEqual([17, 26]); // x1.5 dynamic
  });

  it("Tremor Burst raises the Stagger Threshold by Potency", () => {
    const { ws, attacker, dummy } = setup();
    dummy.staggerThresholds = [50];
    attacker.skills[0] = onCoin(skill("Quake", "SLOTH", "BLUNT", 1, 0, 1), 0, eff("onHit", [act("tremorBurst", { who: "target", amount: val(1) })]));
    const r = calc(ws, side("identity", attacker.id, { skill: "S1" }), side("enemy", dummy.id, { hpPct: 52, statuses: [{ key: "TREMOR", potency: 30, count: 2 }] }));
    // HP 520 -> threshold 500 rises by 30 to 530: above HP, so the dummy is Staggered
    expect(r.defenderStaggered).toBe(1);
  });
});

describe("full battles", () => {
  it("the example workspace plays to the end without errors", () => {
    const ws = sampleWorkspace();
    for (const enc of ws.encounters) {
      const { battle, warnings } = createBattle({ workspace: ws, team: ws.teams[0], encounterId: enc.id, seed: 11 });
      expect(warnings).toEqual([]);
      runToEnd(battle, 40);
      expect(battle.outcome).not.toBeNull();
      expect(battle.log.length).toBeGreaterThan(10);
      // the battle state stays plain JSON (savable)
      expect(() => JSON.parse(JSON.stringify(battle))).not.toThrow();
    }
  });

  it("is reproducible from its seed", () => {
    const ws = sampleWorkspace();
    const run = () => {
      const { battle } = createBattle({ workspace: ws, team: ws.teams[0], encounterId: ws.encounters[0].id, seed: 99 });
      runToEnd(battle, 30);
      return JSON.stringify(battle.stats);
    };
    expect(run()).toBe(run());
  });

  it("batch runs aggregate win rates", () => {
    const ws = sampleWorkspace();
    const r = runBatch({ workspace: ws, team: ws.teams[0], encounterId: ws.encounters[0].id }, { runs: 20, maxTurns: 30, useEgo: true, seed: 5 });
    expect(r.runs).toBe(20);
    expect(r.wins).toBeGreaterThanOrEqual(0);
    expect(r.units.length).toBeGreaterThan(0);
  });
});

describe("import", () => {
  it("reads the original one-file Sinner's Workshop export", () => {
    const legacy = {
      version: 1,
      identities: [
        {
          id: "id-1", kind: "identity", name: "Old Faust", sinner: 1, rank: 2, hp: 150, speedMin: 3, speedMax: 6,
          resist: { SLASH: 1.5, PENETRATE: 0.75, HIT: 1 },
          skills: [
            { name: "A", sin: "CRIMSON", dmg: "SLASH", base: 3, coin: 3, coins: 2 },
            { name: "B", sin: "AZURE", dmg: "PENETRATE", base: 4, coin: 4, coins: 2 },
            { name: "C", sin: "VIOLET", dmg: "HIT", base: 5, coin: 4, coins: 3 },
          ],
          defense: { name: "Block", sin: "CRIMSON", type: "EVADE", base: 5, coin: 4, coins: 1 },
        },
      ],
      enemies: [{ id: "e1", kind: "enemy", name: "Old Foe", level: 30, hp: 300, speedMin: 2, speedMax: 4, resist: { SLASH: 1, PENETRATE: 1, HIT: 2 }, skills: [{ name: "Hit", sin: "AMBER", dmg: "HIT", base: 3, coin: 3, coins: 2 }] }],
    };
    const r = importAny(JSON.stringify(legacy));
    expect(r.source).toBe("legacy");
    expect(r.items).toHaveLength(2);
    const idn = r.items[0] as ReturnType<typeof newIdentity>;
    expect(idn.sinner).toBe("Faust");
    expect(idn.skills[1].sin).toBe("GLOOM");
    expect(idn.skills[1].dmgType).toBe("PIERCE");
    expect(idn.resist.PIERCE).toBe(0.75);
    expect(idn.defense[0].kind).toBe("evade");
  });
});

describe("safety", () => {
  it("a reuse rule without a limit cannot loop forever", () => {
    const { ws, attacker, dummy } = setup();
    attacker.skills[0] = onCoin(skill("Loop", "WRATH", "SLASH", 4, 0, 1), 0, eff("onHit", [act("reuseCoin", { amount: val(1) })]));
    const r = calc(ws, side("identity", attacker.id, { skill: "S1" }), side("enemy", dummy.id));
    const heads = r.scenarios.find((s) => s.name === "All Heads, no crit")!;
    expect(heads.hits.length).toBe(6); // 1 + 5 reuses
  });

  it("Resonance passives can be assumed active in the calculator", () => {
    const { ws, attacker, dummy } = setup();
    attacker.passives = [
      { id: "p", name: "Res bonus", kind: "combat", reqMode: "res", reqSin: "WRATH", reqCount: 3, notes: "", effects: [eff("always", [mod("dmgDealt", 100)])] },
    ];
    const on = calc(ws, side("identity", attacker.id, { skill: "S1" }), side("enemy", dummy.id));
    const off = calc(ws, side("identity", attacker.id, { skill: "S1" }), side("enemy", dummy.id), "oneSided", { assumePassives: false });
    const f = (r: typeof on) => r.scenarios.find((s) => s.name === "All Heads, no crit")!.hits.map((h) => h.final);
    expect(f(off)).toEqual([11, 17]);
    expect(f(on)).toEqual([23, 34]); // x2 dynamic
  });
});

describe("custom coins", () => {
  const heads = (r: ReturnType<typeof calc>) => r.scenarios.find((s) => s.name === "All Heads, no crit")!.hits;
  const tails = (r: ReturnType<typeof calc>) => r.scenarios.find((s) => s.name === "All Tails")!.hits;

  it("a coin can have its own Coin Power", () => {
    const { ws, attacker, dummy } = setup();
    attacker.skills[0] = skill("Big finish", "WRATH", "SLASH", 4, 4, 2, { coins: [newCoin(), newCoin("normal", { power: 10 })] });
    const r = calc(ws, side("identity", attacker.id, { skill: "S1" }), side("enemy", dummy.id));
    expect(heads(r).map((h) => h.roll)).toEqual([8, 18]);
    expect(heads(r).map((h) => h.final)).toEqual([11, 26]);
  });

  it("multiply coins multiply the power on Heads", () => {
    const { ws, attacker, dummy } = setup();
    attacker.skills[0] = skill("Doubler", "WRATH", "SLASH", 4, 4, 2, { coins: [newCoin(), newCoin("normal", { op: "multiply", mult: 2 })] });
    const r = calc(ws, side("identity", attacker.id, { skill: "S1" }), side("enemy", dummy.id));
    expect(heads(r).map((h) => h.roll)).toEqual([8, 16]);
    expect(tails(r).map((h) => h.roll)).toEqual([4, 4]);
  });

  it("a coin fixed to Heads lands Heads even when everything else lands Tails", () => {
    const { ws, attacker, dummy } = setup();
    attacker.skills[0] = skill("Sure thing", "WRATH", "SLASH", 4, 4, 2, { coins: [newCoin(), newCoin("normal", { fixed: "heads" })] });
    const r = calc(ws, side("identity", attacker.id, { skill: "S1" }), side("enemy", dummy.id));
    expect(tails(r).map((h) => h.roll)).toEqual([4, 8]);
  });

  it("a coin can deal its own damage type", () => {
    const { ws, attacker, dummy } = setup();
    dummy.resist = { SLASH: 1, PIERCE: 2, BLUNT: 1 };
    attacker.skills[0] = skill("Mixed", "WRATH", "SLASH", 4, 4, 2, { coins: [newCoin(), newCoin("normal", { dmgType: "PIERCE" })] });
    const r = calc(ws, side("identity", attacker.id, { skill: "S1" }), side("enemy", dummy.id));
    // coin 1 Slash x1: 8 * 1.444 = 11; coin 2 Pierce x2: 12 * 2.444 = 29
    expect(heads(r).map((h) => h.final)).toEqual([11, 29]);
  });

  it("custom coin types set Clash behaviour, cracked power and carry their own rules", () => {
    const { ws, attacker } = setup();
    ws.coinTypes.push({
      id: "ct1", kind: "coinType", key: "COIN_EMBER", name: "Ember Coin", color: "#ff7a3d", description: "", clash: "unbreakable",
      power: null, op: "add", mult: 2, dmgType: null, sin: null, headsBonus: 0, fixed: "none", ignoreParalyze: false, crackedPower: 3,
      effects: [eff("onHit", [inflict("BURN", 1)])], notes: "", tags: [], createdAt: 0, updatedAt: 0,
    });
    attacker.skills[0] = skill("Stubborn", "WRATH", "SLASH", 2, 3, 2, { coins: [newCoin("normal", { customType: "COIN_EMBER" }), newCoin("normal", { customType: "COIN_EMBER" })] });
    const foe = newEnemy({ name: "Wall", level: 65, hp: 500, staggerThresholds: [], skills: [skill("Wall", "ENVY", "BLUNT", 30, 0, 1)] });
    ws.enemies.push(foe);
    const r = calc(ws, side("identity", attacker.id, { skill: "S1" }), side("enemy", foe.id, { skill: "K0" }), "clash");
    expect(r.defenderWin).toBe(1); // it loses the Clash...
    const best = r.scenarios.find((s) => s.name === "Best case")!;
    const own = best.hits.filter((h) => h.attacker === "Tester");
    expect(own.map((h) => h.roll)).toEqual([5, 8]); // ...but cracked coins still hit with Coin Power 3
    expect(best.log.some((l) => l.text.includes("Burn") && l.text.includes("Ember Coin"))).toBe(true);
  });

  it("exact Clash odds handle different coins", async () => {
    const { clashOdds, powerDist } = await import("../src/engine/odds");
    const same = clashOdds({ base: 4, coinPower: 4, coins: 3, p: 0.6, bonus: 0 }, { base: 6, coinPower: 3, coins: 2, p: 0.5, bonus: 1 });
    const spec = clashOdds(
      { base: 4, coins: [0, 1, 2].map(() => ({ p: 0.6, op: "add" as const, value: 4 })), bonus: 0 },
      { base: 6, coins: [0, 1].map(() => ({ p: 0.5, op: "add" as const, value: 3 })), bonus: 1 },
    );
    expect(spec.win).toBeCloseTo(same.win, 10);
    const d = powerDist(4, [{ p: 0.5, op: "add", value: 4 }, { p: 1, op: "multiply", value: 2 }]);
    expect([...d.entries()].sort()).toEqual([[16, 0.5], [8, 0.5]].sort());
  });
});

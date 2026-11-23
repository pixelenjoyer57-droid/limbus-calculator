import { describe, expect, it } from "vitest";
import { emptyWorkspace, newEnemy, newIdentity } from "../src/data/defaults";
import { act, cond, eff, inflict, onCoin, skill } from "../src/data/build";
import { runCalc, type Combatant } from "../src/engine/calc";
import { describeEffect } from "../src/engine/describe";
import { val, zIdentity } from "../src/data/schema";
import { convert, type StatusLookup } from "../scripts/gamedata/effects";

const side = (kind: "identity" | "enemy", id: string, extra: Partial<Combatant> = {}): Combatant => ({
  kind, id, level: 0, uptie: 4, egos: {}, sp: 0, hpPct: 100, stagger: 0, speed: 5, statuses: [], skill: "", part: 0, resonance: 0, ...extra,
});

function run(effects: ReturnType<typeof eff>[], coinCount = 1) {
  const ws = emptyWorkspace();
  const attacker = newIdentity({ name: "Tester", level: 65, hp: 200, hpPerLevel: 0, staggerThresholds: [] });
  attacker.skills[0] = onCoin(skill("Reuser", "WRATH", "SLASH", 4, 4, coinCount), 0, ...effects);
  const dummy = newEnemy({ name: "Dummy", level: 45, hp: 1000, hasSanity: false, staggerThresholds: [], skills: [], slots: 0, slotsMax: 0 });
  ws.identities.push(attacker);
  ws.enemies.push(dummy);
  const r = runCalc({ workspace: ws, attacker: side("identity", attacker.id, { skill: "S1" }), defender: side("enemy", dummy.id), exchange: "oneSided", turnEnd: true, runs: 50, seed: 7, gifts: [] });
  return r.scenarios.find((s) => s.name === "All Heads, no crit")!;
}
const reuse = (n = 1) => act("reuseCoin", { amount: val(n) });

describe("coin Reuse", () => {
  it("reuses once with perUse 1, not five times", () => {
    expect(run([eff("onHit", [reuse()], [], { perUse: 1 })]).hits.length).toBe(2);
  });
  it("reuses twice for amount 2", () => {
    expect(run([eff("onHit", [reuse(2)], [], { perUse: 1 })]).hits.length).toBe(3);
  });
  it("is capped without a limit", () => {
    expect(run([eff("onHit", [reuse()])]).hits.length).toBe(6);
  });
  it("a [Reuse - On Hit] effect only fires on the reused hit", () => {
    const s = run([eff("onHit", [reuse()], [], { perUse: 1 }), eff("onHit", [inflict("BURN", 3)], [cond("isReuse")])]);
    expect(s.hits.length).toBe(2);
    // one Burn application (Potency 3, Count 1): 3 damage at turn end on top of the two hits
    const plain = run([eff("onHit", [reuse()], [], { perUse: 1 })]);
    expect(s.defenderDamage - plain.defenderDamage).toBe(3);
  });
  it("describes itself", () => {
    expect(describeEffect(eff("onHit", [reuse()], [cond("isReuse")], { perUse: 2 }))).toMatch(/times per Skill/);
    expect(describeEffect(eff("onHit", [reuse()], [cond("isReuse")], { perUse: 2 }))).toMatch(/Reuse/);
  });
});

describe("wiki converter: Reuse", () => {
  const lookup: StatusLookup = (name) => ({ key: name.toUpperCase(), mode: "pc" });
  const one = (t: string) => convert(t, "coin", lookup);
  const reuseOf = (t: string) => {
    const r = one(t);
    expect(r.notes).toEqual([]);
    expect(r.effects.length).toBe(1);
    return r.effects[0];
  };
  const kinds = (e: ReturnType<typeof reuseOf>) => e.conditions.map((c) => c.kind);

  it("reads the common wordings", () => {
    let e = reuseOf("[On Hit] At 5+ Speed, Reuse Coin once (once per Skill)");
    expect([e.trigger, e.perUse, e.actions[0].kind, e.actions[0].amount.base]).toEqual(["onHit", 1, "reuseCoin", 1]);
    expect(e.conditions[0].value).toBe(5);
    e = reuseOf("[On Hit] If this unit has ⟦Haste⟧, Reuse this Coin (once per Skill)");
    expect([e.perUse, kinds(e)]).toEqual([1, ["hasStatus"]]);
    e = reuseOf("[Heads Hit] Reuse this Coin (3 times per Skill)");
    expect([e.trigger, e.perUse, e.actions[0].amount.base]).toEqual(["headsHit", 3, 1]);
    e = reuseOf("[Heads Hit] If target has 3+ negative effects, reuse this Coin (2 time max)");
    expect([e.perUse, e.conditions[0].q?.kind]).toEqual([2, "negativeEffects"]);
    e = reuseOf("[On Hit without Cracking] Reuse this Coin once (once per Skill)");
    expect([e.trigger, e.perUse]).toEqual(["hitWithoutCracking", 1]);
    e = reuseOf("[On Hit] If target has 4+ ⟦Sinking⟧ Count, Reuse this Coin (twice)");
    expect([e.perUse, e.actions[0].amount.base, e.conditions[0].q?.kind]).toEqual([1, 2, "statusCount"]);
    e = reuseOf("[On Hit] If this unit's Speed is faster than the target's by 3 or more, reuse this Coin (once)");
    expect([e.perUse, e.conditions[0].q?.kind, e.conditions[0].value]).toEqual([1, "speedDiff", 3]);
    e = reuseOf("[On Hit] At 20+ SP, Reuse this Coin (2 times max per Skill)");
    expect([e.perUse, e.conditions[0].q?.kind]).toEqual([2, "sp"]);
    e = reuseOf("[On Hit] Reuse this Coin (max 3 times)");
    expect(e.perUse).toBe(3);
  });

  it("maps Crit - Heads Hit and Reuse - On Hit labels", () => {
    let e = reuseOf("[Crit - Heads Hit] Reuse this Coin (once per Skill)");
    expect([e.trigger, kinds(e), e.perUse]).toEqual(["onCrit", ["isHeads"], 1]);
    e = reuseOf("[On Crit - Heads Hit] Reuse this Coin (once per Skill)");
    expect([e.trigger, kinds(e)]).toEqual(["onCrit", ["isHeads"]]);
    e = reuseOf("[Reuse - On Hit] Inflict 3 ⟦Burn⟧");
    expect([e.trigger, kinds(e), e.actions[0].kind]).toEqual(["onHit", ["isReuse"], "inflict"]);
  });

  it("keeps unsupported Reuse wording as notes", () => {
    for (const t of [
      "[On Use] Reuse this Skill (once)",
      "[On Hit] Reuse the final Coin once",
      "[On Hit] Reuse this Coin (this unit's Speed / 5) times (max 3)",
      "[On Hit] 30% chance to Reuse this Coin",
      "External effects cannot trigger this Skill to be Reused",
    ]) {
      const r = one(t);
      expect(r.effects.some((e) => e.actions.some((a) => a.kind === "reuseCoin")), t).toBe(false);
      expect(r.notes.length, t).toBe(1);
    }
  });
});

describe("Identity with many skills", () => {
  it("keeps 8 skills through zIdentity.parse", () => {
    const base = newIdentity({ name: "Many" });
    const skills = Array.from({ length: 8 }, (_, i) => ({ ...base.skills[0], id: "s" + i, name: "Skill " + i, label: i > 2 ? `S1-${i}` : "" }));
    const parsed = zIdentity.parse({ ...base, skills });
    expect(parsed.skills.length).toBe(8);
    expect(parsed.skills[5].label).toBe("S1-5");
  });
});

import { describe, expect, it } from "vitest";
import {
  absoluteResonanceBonus, clashCountMod, clashWinSp, critModifier, finalDamage, guardReducedRoll, headsChance,
  levelAdvantage, levelClashBonus, overclockCost, physResistMod, poiseCritChance, resistMod, resonanceBonus, hpAtLevel,
  allyDeathSp, binomAtLeast,
} from "../src/engine/formulas";
import { corrosionChance } from "../src/engine/constants";
import { clashOdds } from "../src/engine/odds";

describe("resistances (Damage Formula page)", () => {
  it("maps resistance values to static modifiers", () => {
    expect(resistMod(2)).toBe(1);
    expect(resistMod(1.5)).toBe(0.5);
    expect(resistMod(1)).toBe(0);
    expect(resistMod(0.75)).toBeCloseTo(-0.125);
    expect(resistMod(0.5)).toBeCloseTo(-0.25); // "25% less damage, not 50% less"
    expect(resistMod(0)).toBe(-0.5); // Immune only halves damage
  });
  it("wiki example: Slash x1.5 + Wrath x0.75 = +37%", () => {
    expect(resistMod(1.5) + resistMod(0.75)).toBeCloseTo(0.375);
  });
  it("wiki example: Stagger++ with Envy x1.5 = +250%", () => {
    expect(physResistMod(0.5, 3) + resistMod(1.5)).toBeCloseTo(2.5);
  });
  it("stagger levels give +1 / +1.5 / +2 and replace the damage type resistance", () => {
    expect(physResistMod(0.25, 1)).toBe(1);
    expect(physResistMod(2, 2)).toBe(1.5);
    expect(physResistMod(1, 3)).toBe(2);
  });
});

describe("level advantage", () => {
  it("follows (Off-Def)/(|Off-Def|+25)", () => {
    const table: [number, number][] = [[1, 0.03], [3, 0.10], [6, 0.19], [9, 0.26], [20, 0.44], [25, 0.5], [30, 0.55], [40, 0.62], [100, 0.8]];
    for (const [d, v] of table) {
      expect(levelAdvantage(60 + d, 60)).toBeCloseTo(v, 1);
      expect(levelAdvantage(60, 60 + d)).toBeCloseTo(-v, 1);
    }
    expect(levelAdvantage(53, 50)).toBeCloseTo(3 / 28);
  });
  it("gives +1 Clash Power per 3 levels, rounded down", () => {
    expect(levelClashBonus(64, 60)).toBe(1); // "4 Level -> +1 Power"
    expect(levelClashBonus(65, 60)).toBe(1); // "5 Levels higher = +1"
    expect(levelClashBonus(66, 60)).toBe(2);
    expect(levelClashBonus(62, 60)).toBe(0);
    expect(levelClashBonus(60, 66)).toBe(0); // only the higher side gains
  });
});

describe("damage", () => {
  it("crit x 2 Fragile = 1.44 (static and dynamic multiply)", () => {
    const r = finalDamage({ coinRoll: 100, staticParts: [{ label: "crit", value: critModifier() }], dynamicParts: [{ label: "fragile", value: 0.2 }] });
    expect(r.raw).toBeCloseTo(144);
    expect(r.final).toBe(144);
  });
  it("clash count 7 is +21%", () => {
    expect(clashCountMod(7)).toBeCloseTo(0.21);
    expect(clashCountMod(120)).toBeCloseTo(2.94); // capped at 98
  });
  it("rounds down", () => {
    expect(finalDamage({ coinRoll: 13, staticParts: [{ label: "x", value: 0.375 }], dynamicParts: [] }).final).toBe(17); // 17.875
  });
  it("never drops below 5% of the coin roll", () => {
    const r = finalDamage({ coinRoll: 40, staticParts: [{ label: "x", value: -1.5 }], dynamicParts: [] });
    expect(r.final).toBe(2);
    expect(r.floorApplied).toBe("fivePercent");
  });
  it("deals at least 1 damage", () => {
    expect(finalDamage({ coinRoll: 0, staticParts: [], dynamicParts: [] }).final).toBe(1);
    expect(finalDamage({ coinRoll: 8, staticParts: [{ label: "x", value: -0.9 }], dynamicParts: [{ label: "p", value: -0.9 }] }).final).toBe(1);
  });
  it("is not fooled by floating point noise", () => {
    expect(finalDamage({ coinRoll: 10, staticParts: [{ label: "a", value: 0.1 }, { label: "b", value: 0.2 }], dynamicParts: [] }).final).toBe(13);
  });
  it("Clashable Guard reduction keeps at least max(floor(5%), 1)", () => {
    expect(guardReducedRoll(40, 10)).toBe(30);
    expect(guardReducedRoll(20, 25)).toBe(1);
    expect(guardReducedRoll(100, 99)).toBe(5);
  });
});

describe("sanity and clashes", () => {
  it("heads chance is 50 + SP", () => {
    expect(headsChance(27, true)).toBeCloseTo(0.77);
    expect(headsChance(-33, true)).toBeCloseTo(0.17);
    expect(headsChance(30, false)).toBe(0.5);
    expect(headsChance(99, true)).toBeCloseTo(0.95); // SP is capped at 45
  });
  it("SP after a clash win: 10, +20% per clash after the first", () => {
    expect(clashWinSp(1)).toBe(10);
    expect(clashWinSp(2)).toBe(12);
    expect(clashWinSp(5)).toBe(18);
  });
  it("SP lost when an ally of equal or higher level dies", () => {
    expect(allyDeathSp(50, 50)).toBe(10);
    expect(allyDeathSp(52, 50)).toBe(30);
    expect(allyDeathSp(40, 50)).toBe(0);
  });
  it("crit chance is Poise Potency x 5%", () => {
    expect(poiseCritChance(4)).toBeCloseTo(0.2);
    expect(poiseCritChance(20)).toBe(1);
    expect(poiseCritChance(35)).toBe(1);
  });
});

describe("E.G.O and resonance tables", () => {
  it("overclock costs x1.5 rounded up", () => {
    expect(overclockCost(3)).toBe(5);
    expect(overclockCost(25)).toBe(38);
    expect(overclockCost(4)).toBe(6);
  });
  it("corrosion chance by SP after use", () => {
    expect(corrosionChance(0)).toBe(0);
    expect(corrosionChance(-22)).toBe(0);
    expect(corrosionChance(-23)).toBe(0.25);
    expect(corrosionChance(-34)).toBe(0.75);
    expect(corrosionChance(-45)).toBe(1);
  });
  it("resonance bonuses", () => {
    expect([1, 2, 3, 4, 5, 6].map(resonanceBonus)).toEqual([0, 1, 3, 3, 5, 5]);
    expect([2, 3, 4, 5, 6, 12].map(absoluteResonanceBonus)).toEqual([0, 3, 5, 5, 7, 13]);
  });
  it("HP scales linearly with level", () => {
    expect(hpAtLevel(230, 3, 65, 60)).toBe(215);
  });
});

describe("exact clash odds", () => {
  it("a stronger static skill always wins", () => {
    const r = clashOdds({ base: 10, coinPower: 0, coins: 1, p: 0.5, bonus: 0 }, { base: 5, coinPower: 0, coins: 1, p: 0.5, bonus: 0 });
    expect(r.win).toBeCloseTo(1);
  });
  it("mirror matchups are 50/50", () => {
    const s = { base: 4, coinPower: 4, coins: 3, p: 0.5, bonus: 0 };
    const r = clashOdds(s, s);
    expect(r.win).toBeCloseTo(0.5, 6);
    expect(r.win + r.lose).toBeCloseTo(1, 6);
  });
  it("binomial helper", () => {
    expect(binomAtLeast(2, 0.5, 1)).toBeCloseTo(0.75);
  });
});

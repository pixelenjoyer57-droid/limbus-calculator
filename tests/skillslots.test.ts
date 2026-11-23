import { describe, expect, it } from "vitest";
import { identitySkillSlot, moveItem } from "../src/data/schema";
import { newIdentity, newSkill } from "../src/data/defaults";
import { identityUnit } from "../src/engine/setup";
import type { BattleContent } from "../src/engine/types";
import { emptyWorkspace } from "../src/data/defaults";

const content = (): BattleContent => ({ skills: {}, passives: {}, egos: {}, statuses: {}, gifts: [], coinTypes: {} });
const compile = (idn: ReturnType<typeof newIdentity>, uptie: number) => {
  const c = content();
  const ws = emptyWorkspace();
  const u = identityUnit(c, ws, idn, { sinner: idn.sinner, identityId: idn.id, level: idn.level, uptie, egos: {} } as never, "u1", 0);
  return u.attackSkills.map((k) => c.skills[k]);
};

describe("skill slots", () => {
  it("normal 3-skill kit is S1/S2/S3 by position and S3 needs Uptie 3", () => {
    const idn = newIdentity();
    expect(idn.skills.map((s, i) => identitySkillSlot(s, i))).toEqual(["S1", "S2", "S3"]);
    expect(compile(idn, 4).map((s) => s.slot)).toEqual(["S1", "S2", "S3"]);
    expect(compile(idn, 2).map((s) => s.slot)).toEqual(["S1", "S2"]);
  });
  it("a 4th skill with slot S2 gives two S2 options", () => {
    const idn = newIdentity();
    idn.skills.push(newSkill({ name: "Variant", slot: "S2" }));
    expect(compile(idn, 4).filter((s) => s.slot === "S2")).toHaveLength(2);
    expect(identitySkillSlot(newSkill(), 5)).toBe("S3");
  });
  it("a slot S3 skill at position 0 is locked at Uptie 2", () => {
    const idn = newIdentity();
    idn.skills[0].slot = "S3";
    expect(compile(idn, 2).map((s) => s.slot)).toEqual(["S2"]);
    expect(compile(idn, 3)).toHaveLength(3);
  });
  it("reordering moves skills, explicit slots travel with them", () => {
    const idn = newIdentity();
    idn.skills[2].slot = "S1";
    const names = idn.skills.map((s) => s.name);
    moveItem(idn.skills, 2, -1);
    expect(idn.skills.map((s) => s.name)).toEqual([names[0], names[2], names[1]]);
    expect(idn.skills.map((s, i) => identitySkillSlot(s, i))).toEqual(["S1", "S1", "S3"]);
    moveItem(idn.skills, 0, -1);
    expect(idn.skills.map((s) => s.name)[0]).toBe(names[0]);
  });
});

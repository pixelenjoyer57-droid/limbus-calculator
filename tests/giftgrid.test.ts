import { describe, expect, it } from "vitest";
import { newGift, newTeam } from "../src/data/defaults";
import { encodeShareCode, importAny, itemsPayload } from "../src/data/migrate";
import { zTeam, type Gift, type Team } from "../src/data/schema";
import { NO_GIFT_FILTER, giftPasses, keywordText, tierText } from "../src/features/library/giftFilter";
import { MAX_TEAM_GIFTS, countById, countText, giftButtonName, limitMessage, restoreGift, toggleGift, type TeamGift } from "../src/features/team/giftToggle";
import { PAGE, pageInfo, searchItems, showingText } from "../src/lib/search";

const gift = (name: string, over: Partial<Gift> = {}): Gift => newGift({ id: "g:" + name, name, ...over });
const entries = (n: number): TeamGift[] => Array.from({ length: n }, (_, i) => ({ giftId: `g:${i}`, level: 0 }));

describe("team gifts today (saved data)", () => {
  it("a team with a duplicated gift loads unchanged", () => {
    const gifts = [{ giftId: "g:a", level: 2 }, { giftId: "g:b", level: 0 }, { giftId: "g:a", level: 1 }];
    const t = zTeam.parse({ ...newTeam({ name: "T" }), gifts });
    expect(t.gifts).toEqual(gifts);
    expect(countById(t.gifts).get("g:a")).toBe(2);
  });
  it("keeps the 80 cap in the saved format", () => {
    expect(zTeam.parse({ ...newTeam(), gifts: entries(80) }).gifts).toHaveLength(80);
    expect(zTeam.parse({ ...newTeam(), gifts: entries(81) }).gifts).toEqual([]);
  });
  it("a missing gift stays in the list", () => {
    const t = zTeam.parse({ ...newTeam(), gifts: [{ giftId: "g:gone", level: 0 }] });
    expect(t.gifts).toEqual([{ giftId: "g:gone", level: 0 }]);
  });
});

describe("gift filters (shared helper)", () => {
  const legacy = gift("Old", { tags: ["Legacy"], tier: "II" });
  const none = gift("Story", { tags: ["No tier (story/other)"], tier: "I" });
  const burn = gift("Hot", { tier: "III", keyword: "BURN" });
  const ex = gift("Extra", { tier: "EX" });
  it("hides legacy by default and shows it on request", () => {
    expect(giftPasses(legacy, NO_GIFT_FILTER)).toBe(false);
    expect(giftPasses(legacy, { ...NO_GIFT_FILTER, legacy: true })).toBe(true);
  });
  it("filters by tier, including 'No tier'", () => {
    expect(giftPasses(burn, { ...NO_GIFT_FILTER, tier: "III" })).toBe(true);
    expect(giftPasses(burn, { ...NO_GIFT_FILTER, tier: "II" })).toBe(false);
    expect(giftPasses(none, { ...NO_GIFT_FILTER, tier: "I" })).toBe(false);
    expect(giftPasses(none, { ...NO_GIFT_FILTER, tier: "none" })).toBe(true);
    expect(giftPasses(burn, { ...NO_GIFT_FILTER, tier: "none" })).toBe(false);
  });
  it("filters by keyword", () => {
    expect(giftPasses(burn, { ...NO_GIFT_FILTER, keyword: "BURN" })).toBe(true);
    expect(giftPasses(ex, { ...NO_GIFT_FILTER, keyword: "BURN" })).toBe(false);
  });
  it("writes tier and keyword as text", () => {
    expect(tierText(burn)).toBe("Tier III");
    expect(tierText(ex)).toBe("EX");
    expect(tierText(none)).toBe("No tier");
    expect(keywordText(burn)).toBe("Burn");
    expect(keywordText(ex)).toBe("no keyword");
  });
});

describe("search and paging (shared)", () => {
  const items = Array.from({ length: 130 }, (_, i) => gift(`Gift ${String(i).padStart(3, "0")}`, { keyword: i % 2 ? "BURN" : "BLEED" }));
  it("matches every word, in name order", () => {
    const r = searchItems(items, "gift 00 burn");
    expect(r.map((x) => x.name)).toEqual(["Gift 001", "Gift 003", "Gift 005", "Gift 007", "Gift 009"]);
  });
  it("takes an extra test", () => {
    expect(searchItems(items, "", (x) => x.keyword === "BURN")).toHaveLength(65);
  });
  it("words the count, with the total when narrowed", () => {
    expect(showingText(130, 60, 130)).toBe("Showing 60 of 130");
    expect(showingText(5, 60, 728)).toBe("Showing 5 of 5 (728 in total)");
  });
  it("pages 60 at a time", () => {
    expect(PAGE).toBe(60);
    expect(pageInfo(130, 60)).toEqual({ visible: 60, left: 70, nextShown: 120 });
    expect(pageInfo(130, 120).left).toBe(10);
    expect(pageInfo(20, 60)).toMatchObject({ visible: 20, left: 0 });
  });
});

describe("turning gifts on and off", () => {
  it("adds at Base level without touching other entries", () => {
    const before = [{ giftId: "g:a", level: 2 }];
    const r = toggleGift(before, "g:b");
    expect(r.kind).toBe("added");
    expect(r.gifts).toEqual([{ giftId: "g:a", level: 2 }, { giftId: "g:b", level: 0 }]);
    expect(before).toHaveLength(1);
  });
  it("turn off removes one entry of a duplicate and keeps the other, with its level", () => {
    const r = toggleGift([{ giftId: "g:a", level: 2 }, { giftId: "g:b", level: 0 }, { giftId: "g:a", level: 1 }], "g:a");
    expect(r.kind).toBe("removed");
    expect(r.gifts).toEqual([{ giftId: "g:a", level: 2 }, { giftId: "g:b", level: 0 }]);
    expect(countById(r.gifts).get("g:a")).toBe(1);
  });
  it("undo puts the entry back where it was", () => {
    const start = [{ giftId: "g:a", level: 2 }, { giftId: "g:b", level: 1 }, { giftId: "g:a", level: 1 }];
    const r = toggleGift(start, "g:a");
    if (r.kind !== "removed") throw new Error("expected removal");
    expect(restoreGift(r.gifts, r.entry, r.index)).toEqual(start);
  });
  it("refuses the 81st gift and changes nothing", () => {
    const full = entries(MAX_TEAM_GIFTS);
    const r = toggleGift(full, "g:new");
    expect(r.kind).toBe("limit");
    expect(r.gifts).toEqual(full);
    expect(limitMessage).toMatch(/80/);
  });
  it("at the limit, gifts that are on can still be turned off and then undone", () => {
    const full = entries(MAX_TEAM_GIFTS);
    const r = toggleGift(full, "g:5");
    expect(r.kind).toBe("removed");
    expect(r.gifts).toHaveLength(79);
    if (r.kind !== "removed") return;
    expect(restoreGift(r.gifts, r.entry, r.index)).toEqual(full);
    expect(restoreGift(full, r.entry, r.index)).toBeNull();
  });
  it("counts entries", () => {
    expect(countText(3)).toBe("3 of 80 selected");
  });
});

describe("gift button names", () => {
  it("say gift, tier, keyword and source, and no state", () => {
    const g = gift("Hot", { tier: "III", keyword: "BURN" });
    const name = giftButtonName(g, tierText(g), keywordText(g), false);
    expect(name).toBe("Hot, Tier III, Burn, from the game");
    expect(giftButtonName(g, tierText(g), keywordText(g), true)).toBe("Hot, Tier III, Burn, your content");
    expect(name).not.toMatch(/\b(on|off|pressed|selected)\b/i);
  });
});

describe("share codes", () => {
  it("round-trips a team with 80 gifts, a duplicate and a game gift", () => {
    const gifts: TeamGift[] = [...entries(78), { giftId: "g:3", level: 1 }, { giftId: "own-gift-1", level: 2 }];
    const team: Team = zTeam.parse({ ...newTeam({ name: "Eighty" }), gifts });
    const back = importAny(encodeShareCode(itemsPayload([team])));
    expect(back.items).toHaveLength(1);
    const t = back.items[0] as Team;
    expect(t.gifts).toHaveLength(80);
    expect(t.gifts).toEqual(gifts);
  });
});

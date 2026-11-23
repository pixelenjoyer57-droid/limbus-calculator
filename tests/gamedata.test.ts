// @ts-ignore node types are not installed; vitest runs in Node
import { readFileSync } from "node:fs";
import { describe, expect, it, beforeAll } from "vitest";
import { zCustomStatus, zEnemy, zGift, zIdentity, zWorkspace, type Enemy, type Identity } from "../src/data/schema";
import { useGameData } from "../src/gamedata/store";
import { copyToWorkshop, referencedStatusKeys, withGameData, wikiUrl } from "../src/gamedata/copy";

const read = (f: string) => JSON.parse(readFileSync(`public/gamedata/${f}.json`, "utf8")) as Record<string, unknown>[];

let identities: Identity[], enemies: Enemy[];
beforeAll(() => {
  const statuses = read("statuses").map((x) => zCustomStatus.parse(x));
  identities = read("identities").map((x) => zIdentity.parse(x));
  enemies = read("enemies").slice(0, 300).map((x) => zEnemy.parse(x));
  const gifts = read("gifts").slice(0, 20).map((x) => zGift.parse(x));
  const mk = <T extends { id: string }>(items: T[]) => ({ status: "ready" as const, items, byId: new Map(items.map((i) => [i.id, i])), error: "" });
  useGameData.setState((s) => ({
    kinds: { ...s.kinds, status: mk(statuses), identity: mk(identities), enemy: mk(enemies), gift: mk(gifts) } as never,
    statusByKey: new Map(statuses.map((x) => [x.key, x])),
  }));
});

const ws = () => zWorkspace.parse({ id: "w", name: "t" });

describe("game data", () => {
  it("parses every id as prefixed and url-safe", () => {
    for (const f of ["identities", "egos", "enemies", "gifts"]) for (const x of read(f)) expect(String(x.id)).toMatch(/^g:[a-z]+:[A-Za-z0-9_.:-]*$/);
  });

  it("copyToWorkshop makes a fresh copy and collects referenced game statuses", () => {
    const src = [...enemies, ...identities].find((x) => referencedStatusKeys(x).length > 0)!;
    expect(src).toBeTruthy();
    const made = copyToWorkshop(src, ws());
    expect(made[0].id.startsWith("g:")).toBe(false);
    expect((made[0] as { name: string }).name).toBe(src.name);
    expect(JSON.stringify(made[0])).not.toContain('"g:');
    const keys = made.slice(1).map((s) => (s as { key: string }).key);
    for (const k of referencedStatusKeys(src)) if (useGameData.getState().statusByKey.has(k)) expect(keys).toContain(k);
    // statuses the workspace already has are not copied again
    const w = ws();
    w.statuses.push(zCustomStatus.parse({ id: "x", key: keys[0], name: "mine" }));
    expect(copyToWorkshop(src, w).some((s) => (s as { key?: string }).key === keys[0])).toBe(false);
  });

  it("withGameData adds referenced items and their statuses without touching the input", () => {
    const e = enemies.find((x) => referencedStatusKeys(x).length > 0)!;
    const base = ws();
    const out = withGameData(base, [e.id, identities[0].id]);
    expect(out).not.toBe(base);
    expect(base.enemies.length).toBe(0);
    expect(out.enemies.map((x) => x.id)).toContain(e.id);
    expect(out.identities.map((x) => x.id)).toContain(identities[0].id);
    const have = new Set(out.statuses.map((s) => s.key));
    for (const k of referencedStatusKeys(e)) if (useGameData.getState().statusByKey.has(k)) expect(have.has(k)).toBe(true);
  });

  it("builds wiki links", () => {
    expect(wikiUrl({ name: "A B", source: "The Barber/Enemy" })).toBe("https://limbuscompany.wiki.gg/wiki/The_Barber/Enemy");
    expect(wikiUrl({ name: "Dream's End", source: "Module:EgoGift/data" })).toContain("Dream's_End");
  });
});

import { describe, expect, it } from "vitest";
import LZString from "lz-string";
import { boundedDecompress, encodeShareCode, importAny, itemsPayload, migrateWorkspace } from "../src/data/migrate";
import { newIdentity } from "../src/data/defaults";

describe("share codes", () => {
  it("bounded decoder matches lz-string on real data", () => {
    const samples = [
      JSON.stringify({ a: 1, b: "héllo wörld ✓", list: Array.from({ length: 400 }, (_, i) => ({ i, name: "Item " + (i % 7) })) }),
      "x",
      "abababababababababababab",
      Array.from({ length: 3000 }, (_, i) => String.fromCharCode(32 + ((i * 7919) % 5000))).join(""),
    ];
    for (const s of samples) {
      const enc = LZString.compressToEncodedURIComponent(s);
      expect(boundedDecompress(enc)).toBe(s);
    }
  });

  it("round-trips an items payload", () => {
    const it = newIdentity({ name: "Test" });
    const r = importAny(encodeShareCode(itemsPayload([it])));
    expect(r.source).toBe("items");
    expect(r.items).toHaveLength(1);
  });

  it("refuses a decompression bomb instead of exhausting memory", () => {
    // 600 KB of output from a few hundred input characters; the cap stops decoding early.
    const bomb = LZString.compressToEncodedURIComponent("a".repeat(600_000));
    expect(bomb.length).toBeLessThan(5_000);
    expect(boundedDecompress(bomb, 100_000)).toBeNull();
    expect(boundedDecompress(bomb, 1_000_000)).toBe("a".repeat(600_000));
  });

  it("rejects garbage and oversized input without throwing", () => {
    expect(importAny("SW1:!!!not-a-code").source).toBe("unknown");
    expect(importAny("").source).toBe("unknown");
    expect(importAny("x".repeat(13_000_000)).source).toBe("unknown");
  });
});

describe("hostile payloads", () => {
  it("never throws on keys that exist on Object.prototype", () => {
    for (const k of ["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf"]) {
      expect(() => importAny(JSON.stringify({ kind: k }))).not.toThrow();
      expect(importAny(JSON.stringify({ kind: k })).items).toHaveLength(0);
      expect(importAny(JSON.stringify({ format: "sinners-workshop/items", items: [{ kind: k }] })).items).toHaveLength(0);
    }
    const legacy = { identities: [{ sinner: 0, name: "x", skills: [{ sin: "constructor", dmg: "toString", coin: 1 }], defense: { sin: "__proto__" } }] };
    const r = importAny(JSON.stringify(legacy));
    expect(r.source).toBe("legacy");
    for (const it of r.items) for (const s of (it as { skills: { sin: unknown; dmgType: unknown }[] }).skills) {
      expect(typeof s.sin).toBe("string");
      expect(typeof s.dmgType).toBe("string");
    }
  });

  it("does not pollute Object.prototype via __proto__ / constructor keys", () => {
    const evil = '{"schemaVersion":1,"name":"x","__proto__":{"polluted":"yes"},"identities":[{"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"polluted":"yes"}}}]}';
    importAny(evil);
    migrateWorkspace(JSON.parse(evil));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("imported items cannot claim ids in the game's g: namespace", () => {
    const it = { ...newIdentity({ name: "Fake game item" }), id: "g:id:1234" };
    const r = importAny(JSON.stringify(itemsPayload([it])));
    expect(r.items[0].id.startsWith("g:")).toBe(false);
    const ws = importAny(JSON.stringify({ schemaVersion: 1, identities: [it] }));
    expect(ws.workspace!.identities[0].id.startsWith("g:")).toBe(false);
  });

  it("caps the number of items taken from one collection", () => {
    const many = Array.from({ length: 5000 }, () => newIdentity());
    expect(migrateWorkspace({ identities: many }).identities.length).toBeLessThanOrEqual(3000);
  });

  it("keeps markup as plain text data (React escapes it when rendered)", () => {
    const it = newIdentity({ name: '<img src=x onerror=alert(1)>' });
    const r = importAny(JSON.stringify(itemsPayload([it])));
    expect((r.items[0] as { name: string }).name).toBe('<img src=x onerror=alert(1)>');
  });
});

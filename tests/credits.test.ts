import { describe, expect, it } from "vitest";
import { CREDITS, decodeShareCode, encodeShareCode, importAny, itemsPayload, withCredits } from "../src/data/migrate";
import { newIdentity } from "../src/data/defaults";
import { zWorkspace } from "../src/data/schema";

describe("credits in exports", () => {
  const own = newIdentity({ name: "Mine" });
  const copied = newIdentity({ name: "Copy", source: "https://limbuscompany.wiki.gg/wiki/Test" });

  it("is added only when a game-sourced item is included", () => {
    expect((itemsPayload([own]) as Record<string, unknown>).credits).toBeUndefined();
    expect((itemsPayload([copied]) as Record<string, unknown>).credits).toBe(CREDITS);
    const ws = zWorkspace.parse({ identities: [copied] });
    expect((withCredits(ws) as Record<string, unknown>).credits).toBe(CREDITS);
    expect((withCredits(zWorkspace.parse({ identities: [own] })) as Record<string, unknown>).credits).toBeUndefined();
  });

  it("round-trips through share codes and files, and the field is ignored on import", () => {
    const code = encodeShareCode(itemsPayload([copied]));
    expect((decodeShareCode(code) as Record<string, unknown>).credits).toBe(CREDITS);
    const r = importAny(code);
    expect(r.source).toBe("items");
    expect(r.items).toHaveLength(1);
    const wsFile = JSON.stringify(withCredits(zWorkspace.parse({ identities: [copied] })));
    const w = importAny(wsFile);
    expect(w.source).toBe("workspace");
    expect(w.workspace?.identities).toHaveLength(1);
    expect(Object.keys(w.workspace ?? {})).not.toContain("credits");
  });

  it("old files without credits still import", () => {
    expect(importAny(JSON.stringify({ format: "sinners-workshop/items", version: 1, items: [own] })).items).toHaveLength(1);
  });
});

describe("zod under the CSP", () => {
  it("runs without the eval-based JIT (it would be reported as a CSP violation)", async () => {
    const { config } = await import("zod");
    expect(config().jitless).toBe(true);
  });
});

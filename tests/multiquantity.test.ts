// @ts-ignore node types are not installed; vitest runs in Node
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { MAX_QUANTITIES, readQuantities, writeQuantities, zQuantity, zValue, zWorkspace, type Quantity, type Value } from "../src/data/schema";
import { describeValue } from "../src/engine/describe";
import { evalValue, type Ctx } from "../src/engine/effects";
import { MAX_DECODED_CHARS, MAX_SHARE_CHARS, decodeShareCode, encodeShareCode, importAny, itemsPayload } from "../src/data/migrate";
import { emptyWorkspace, newIdentity } from "../src/data/defaults";
import { eff, mod, skill, onCoin } from "../src/data/build";
import { useWorkspace } from "../src/store/workspace";
import {
  LIMIT_TEXT, addedMessage, duplicateOf, hasDuplicates, nextQuantity, quantityKey, removedMessage,
} from "../src/features/library/quantityList";

const st = (status: string, extra: Partial<Quantity> = {}): Quantity => zQuantity.parse({ kind: "statusPotency", who: "target", status, ...extra });
const perOf = (qs: Quantity[], every = 1, amount = 1) => {
  const per = { q: qs[0], q2: qs[1] ?? null, every, amount } as NonNullable<Value["per"]>;
  writeQuantities(per, qs);
  return { base: 0, per, min: null, max: null } as Value;
};
const unit = (statuses: Record<string, number>) => ({
  level: 1, speed: 1, hasSanity: false, sp: 0, side: "ally",
  statuses: Object.entries(statuses).map(([key, potency]) => ({ key, potency, count: potency })),
});
const ctx = (target: Record<string, number>): Ctx => ({ b: { content: { statuses: {} }, turn: 1 } as never, self: unit({}) as never, other: unit(target) as never });
const rawVal = (qs: unknown[], extra: Record<string, unknown> = {}) => ({ base: 0, per: { q: qs[0], q2: qs[1] ?? null, qx: qs.slice(2), every: 3, amount: 1, ...extra }, min: null, max: null });
const rq = (status: string) => ({ kind: "statusPotency", who: "target", status, field: "potency", sin: "WRATH" });

describe("quantity list helpers", () => {
  it("reads and writes the ordered list, compacting and capping at 5", () => {
    const qs = ["A", "B", "C", "D", "E"].map((s) => st(s));
    const v = perOf(qs);
    expect(readQuantities(v.per!).map((x) => x.status)).toEqual(["A", "B", "C", "D", "E"]);
    expect(v.per!.qx).toHaveLength(3);
    writeQuantities(v.per!, qs.slice(0, 2));
    expect(v.per!.qx).toBeUndefined();
    writeQuantities(v.per!, qs.slice(0, 1));
    expect(v.per!.q2).toBeNull();
    // more than 5 in memory: only 5 are read and written
    const big = ["A", "B", "C", "D", "E", "F", "G", "H"].map((s) => st(s));
    const w = perOf(big);
    expect(readQuantities(w.per!)).toHaveLength(MAX_QUANTITIES);
    expect(w.per!.qx).toHaveLength(3);
    // extras are never read while the second quantity is empty
    const gap = { q: qs[0], q2: null, qx: [qs[2]], every: 1, amount: 1 };
    expect(readQuantities(gap)).toHaveLength(1);
    // writing nothing changes nothing
    writeQuantities(gap, []);
    expect(gap.q).toBe(qs[0]);
  });
});

describe("loading extra quantities", () => {
  it("keeps the first 3 valid extras of 10,000 and stays fast", () => {
    const many = Array.from({ length: 10_000 }, (_, i) => rq("S" + i));
    const t = Date.now();
    const v = zValue.parse(rawVal([rq("A"), rq("B"), ...many]));
    expect(Date.now() - t).toBeLessThan(1000);
    expect(readQuantities(v.per!).map((x) => x.status)).toEqual(["A", "B", "S0", "S1", "S2"]);
  });
  it("only inspects the first entries, so a million junk entries load fast and keep no extras", () => {
    const junk = new Array(1_000_000).fill(0);
    const t = Date.now();
    const v = zValue.parse(rawVal([rq("A"), rq("B")], { qx: junk }));
    expect(Date.now() - t).toBeLessThan(100);
    expect(v.per!.qx).toBeUndefined();
    expect(readQuantities(v.per!)).toHaveLength(2);
  });
  it("drops wrong types and bad entries, keeping valid ones in order", () => {
    const v = zValue.parse(rawVal([rq("A"), rq("B"), 5, null, "BURN", [rq("Z")], rq("C"), undefined, rq("D"), rq("E"), rq("F")]));
    expect(readQuantities(v.per!).map((x) => x.status)).toEqual(["A", "B", "C", "D", "E"]);
  });
  it("reads a non-list as empty and leaves no key", () => {
    for (const bad of [{}, "x", null, 7, true, { length: 3 }]) {
      const v = zValue.parse({ base: 0, per: { q: rq("A"), q2: rq("B"), qx: bad, every: 1, amount: 1 }, min: null, max: null });
      expect(v.per!.qx).toBeUndefined();
      expect(readQuantities(v.per!)).toHaveLength(2);
    }
  });
  it("moves the first extra up when the second quantity is empty", () => {
    const v = zValue.parse(rawVal([rq("A"), null, rq("C"), rq("D")]));
    expect(readQuantities(v.per!).map((x) => x.status)).toEqual(["A", "C", "D"]);
    expect(v.per!.q2?.status).toBe("C");
    const w = zValue.parse({ base: 0, per: { q: rq("A"), qx: [rq("X")], every: 1, amount: 1 }, min: null, max: null });
    expect(w.per!.q2?.status).toBe("X");
    expect(w.per!.qx).toBeUndefined();
  });
  it("is safe with __proto__ and constructor keys", () => {
    const evil = JSON.parse('{"kind":"statusPotency","status":"BURN","__proto__":{"polluted":1},"constructor":{"prototype":{"polluted":2}}}');
    const v = zValue.parse(JSON.parse(`{"base":0,"per":{"q":${JSON.stringify(rq("A"))},"q2":${JSON.stringify(rq("B"))},"qx":[${JSON.stringify(evil)},{"__proto__":{"x":1}},{"constructor":1}],"every":1,"amount":1},"min":null,"max":null}`));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(({} as Record<string, unknown>).x).toBeUndefined();
    expect(Object.keys(v.per!.qx![0])).not.toContain("polluted");
    // a status key named __proto__ is just text
    const w = zValue.parse(rawVal([rq("A"), rq("B"), rq("__proto__"), rq("constructor")]));
    expect(readQuantities(w.per!).map((x) => x.status)).toContain("__proto__");
    expect(({} as Record<string, unknown>).A).toBeUndefined();
    expect(() => evalValue(w, ctx({ __proto__: 1 as never, constructor: 2 as never }))).not.toThrow();
  });
  it("accepts duplicates", () => {
    const v = zValue.parse(rawVal(Array(5).fill(rq("BURN"))));
    expect(readQuantities(v.per!)).toHaveLength(5);
    expect(evalValue({ ...v, per: { ...v.per!, every: 1 } }, ctx({ BURN: 2 }))).toBe(10);
  });
});

describe("engine sum", () => {
  const target = { BURN: 4, BLEED: 5, TREMOR: 3 };
  it("adds two statuses then applies 'for every'", () => {
    expect(evalValue(perOf([st("BURN"), st("BLEED")], 3), ctx(target))).toBe(3);
  });
  it("adds three statuses", () => {
    expect(evalValue(perOf([st("BURN"), st("BLEED"), st("TREMOR")], 2), ctx({ BURN: 1, BLEED: 2, TREMOR: 3 }))).toBe(3);
  });
  it("one quantity and two quantities behave as before", () => {
    expect(evalValue(perOf([st("BURN")], 3), ctx(target))).toBe(1);
    expect(evalValue(perOf([st("BURN"), st("BLEED")], 1), ctx(target))).toBe(9);
  });
  it("counts a missing status as 0", () => {
    expect(evalValue(perOf([st("BURN"), st("NOPE"), st("TREMOR")], 1), ctx(target))).toBe(7);
  });
  it("applies caps after the sum", () => {
    const v = perOf([st("BURN"), st("BLEED"), st("TREMOR")], 1);
    expect(evalValue({ ...v, max: 5 }, ctx(target))).toBe(5);
    expect(evalValue({ ...v, min: 20 }, ctx(target))).toBe(20);
  });
  it("adds only 5 when 8 are in memory", () => {
    const v = perOf(["A", "B", "C", "D", "E"].map((s) => st(s)));
    const eight = { ...v, per: { ...v.per!, qx: ["F", "G", "H", "I"].map((s) => st(s)) } };
    const all = Object.fromEntries("ABCDEFGHI".split("").map((k) => [k, 1]));
    expect(evalValue(eight, ctx(all))).toBe(5);
  });
  it("ignores extras while the second quantity is empty", () => {
    const v = { base: 0, per: { q: st("A"), q2: null, qx: [st("B")], every: 1, amount: 1 }, min: null, max: null } as Value;
    expect(evalValue(v, ctx({ A: 1, B: 10 }))).toBe(1);
  });
  it("stays finite with extreme numbers", () => {
    const v = { ...perOf(["A", "B", "C", "D", "E"].map((s) => st(s)), 0.0001, 999), max: 50, min: -50 };
    const big = Object.fromEntries("ABCDE".split("").map((k) => [k, 1e308]));
    const r = evalValue(v, ctx(big));
    expect(Number.isFinite(r)).toBe(true);
    expect(r).toBeGreaterThanOrEqual(-50);
    expect(r).toBeLessThanOrEqual(50);
    const noCap = evalValue({ ...v, max: null, min: null }, ctx(big));
    expect(Number.isFinite(noCap)).toBe(true);
  });
});

describe("game-style text", () => {
  it("lists three statuses", () => {
    expect(describeValue(perOf([st("BURN"), st("BLEED"), st("TREMOR")], 3, 1))).toBe(
      "1 for every 3 (Burn Potency on target + Bleed Potency on target + Tremor Potency on target)",
    );
  });
  it("keeps one and two quantities as they were", () => {
    expect(describeValue(perOf([st("BURN")], 3))).toBe("1 for every 3 Burn Potency on target");
    expect(describeValue(perOf([st("BURN"), st("BLEED")]))).toBe("1 for every (Burn Potency on target + Bleed Potency on target)");
  });
  it("shows a hostile status name literally and as plain text", () => {
    const name = "<img src=x onerror=alert(1)>";
    const text = describeValue(perOf([st("A"), st("B"), st("C")]), (k) => (k === "C" ? name : k));
    expect(text).toContain(name);
    expect(text.startsWith("1 for every (A")).toBe(true);
  });
});

describe("existing data is unchanged", () => {
  const oldPer = z.object({
    q: zQuantity,
    q2: zQuantity.nullable().catch(null).default(null),
    every: z.number(),
    amount: z.number(),
  });
  const oldDescribe = (v: Value) => {
    const per = v.per!;
    return per.q2 ? [per.q.status, per.q2.status].join("+") : per.q.status;
  };
  const read = (f: string) => JSON.parse(readFileSync(`public/gamedata/${f}.json`, "utf8")) as unknown;
  const walk = (x: unknown, out: Record<string, unknown>[]) => {
    if (Array.isArray(x)) for (const y of x) walk(y, out);
    else if (x && typeof x === "object") {
      const o = x as Record<string, unknown>;
      if (o.per && typeof o.per === "object" && "q" in (o.per as object)) out.push(o);
      for (const k of Object.keys(o)) walk(o[k], out);
    }
  };
  it("all game-data values give the same numbers, text and saved JSON", () => {
    const values: Record<string, unknown>[] = [];
    let itemsWithQ2 = 0;
    for (const f of ["identities", "egos", "enemies", "gifts"]) {
      walk(read(f), values);
      for (const item of read(f) as unknown[]) if (JSON.stringify(item).includes('"q2":{')) itemsWithQ2++;
    }
    expect(itemsWithQ2).toBe(136); // 41 identities, 88 enemies, 6 E.G.O, 1 gift
    let withQ2 = 0;
    let withPer = 0;
    for (const raw of values) {
      const v = zValue.parse(raw);
      if (!v.per) continue;
      withPer++;
      const old = oldPer.parse((raw as { per: unknown }).per);
      expect(v.per.qx).toBeUndefined();
      expect(v.per.q).toEqual(old.q);
      expect(v.per.q2).toEqual(old.q2);
      expect(JSON.stringify(v)).not.toContain("qx");
      expect(readQuantities(v.per).length).toBe(old.q2 ? 2 : 1);
      if (old.q2) {
        withQ2++;
        // two-quantity text keeps its brackets and " + "
        expect(describeValue(v)).toMatch(/ for every( [\d.]+)? \(.+ \+ .+\)/);
      }
      expect(oldDescribe(v)).toBeTruthy();
      // same number as the old sum of q and q2
      const target: Record<string, number> = { [v.per.q.status]: 3, ...(old.q2 ? { [old.q2.status]: 4 } : {}) };
      const sum = target[v.per.q.status] + (old.q2 ? target[old.q2.status] : 0);
      const expected = Math.floor(sum / (v.per.every || 1) + 1e-9) * v.per.amount;
      if (v.per.q.kind === "statusPotency" && v.per.q.who === "target" && (!old.q2 || (old.q2.kind === "statusPotency" && old.q2.who === "target"))) {
        const got = evalValue({ ...v, base: 0, max: null, min: null }, ctx(target));
        expect(got).toBe(expected);
      }
    }
    expect(withQ2).toBeGreaterThanOrEqual(136);
    expect(withPer).toBeGreaterThanOrEqual(withQ2);
  });
  it("a workspace with one- and two-quantity values saves back identical", () => {
    const ws = emptyWorkspace();
    const id = newIdentity({ name: "Fixture" });
    id.skills[0] = onCoin(skill("S", "WRATH", "SLASH", 4, 4, 2), 0, eff("onHit", [mod("coinPower", perOf([st("BURN")], 3)), mod("coinPower", perOf([st("BURN"), st("BLEED")], 3))]));
    id.createdAt = 0;
    id.updatedAt = 0;
    ws.identities.push(id);
    const json = JSON.stringify(ws);
    expect(json).not.toContain("qx");
    expect(JSON.stringify(zWorkspace.parse(JSON.parse(json)))).toBe(json);
  });
});

describe("older copies of the app", () => {
  it("an old reader loads a four-quantity value, drops the extras and gives a smaller number", () => {
    const oldShape = z.object({ q: zQuantity, q2: zQuantity.nullable().catch(null).default(null), every: z.number(), amount: z.number() });
    const v = perOf([st("BURN"), st("BLEED"), st("TREMOR"), st("RUPTURE")], 3);
    const saved = JSON.parse(JSON.stringify(v.per));
    const read = oldShape.parse(saved);
    expect("qx" in read).toBe(false);
    const c = ctx({ BURN: 4, BLEED: 5, TREMOR: 3, RUPTURE: 3 });
    const old = evalValue({ ...v, per: { ...v.per!, q: read.q, q2: read.q2, qx: undefined } }, c);
    expect(evalValue(v, c)).toBe(5);
    expect(old).toBe(3);
  });
});

describe("saving, backup, share codes and undo", () => {
  const four = () => perOf([st("BURN"), st("BLEED"), st("TREMOR"), st("RUPTURE", { field: "count" })], 3);
  const withValue = (value: Value, n = 1) => {
    const ws = emptyWorkspace();
    const id = newIdentity({ name: "Round trip" });
    const sk = skill("S", "WRATH", "SLASH", 4, 4, 1);
    onCoin(sk, 0, eff("onHit", Array.from({ length: n }, () => mod("coinPower", structuredClone(value)))));
    id.skills[0] = sk;
    ws.identities.push(id);
    return ws;
  };
  const valueOf = (ws: { identities: ReturnType<typeof newIdentity>[] }) => ws.identities[0].skills[0].coins[0].effects[0].actions[0].amount;
  const statuses = (v: Value) => readQuantities(v.per!).map((x) => `${x.status}:${x.field}`);
  const expected = ["BURN:potency", "BLEED:potency", "TREMOR:potency", "RUPTURE:count"];

  it("keeps all four through save and reload", () => {
    const ws = withValue(four());
    const back = zWorkspace.parse(JSON.parse(JSON.stringify(ws)));
    expect(statuses(valueOf(back))).toEqual(expected);
  });
  it("keeps all four through a backup file and a share code", () => {
    const ws = withValue(four());
    const backup = importAny(JSON.stringify(ws));
    expect(statuses(valueOf(backup.workspace!))).toEqual(expected);
    const items = importAny(JSON.stringify(itemsPayload(ws.identities)));
    expect(statuses(valueOf({ identities: items.items as never }))).toEqual(expected);
    const code = encodeShareCode(itemsPayload(ws.identities));
    expect(code.startsWith("SW1:")).toBe(true);
    const viaCode = importAny(code);
    expect(statuses(valueOf({ identities: viaCode.items as never }))).toEqual(expected);
  });
  describe("undo", () => {
    afterEach(() => vi.useRealTimers());
    it("brings back the full list in order after a removal and after turning scaling off", () => {
      vi.useFakeTimers();
      (globalThis as { localStorage?: unknown }).localStorage ??= { setItem() {}, getItem: () => null, removeItem() {} };
      const ws = withValue(four());
      useWorkspace.setState({ ws, past: [], future: [] });
      const edit = useWorkspace.getState().edit;
      edit((d) => {
        const per = valueOf(d as never).per!;
        const l = readQuantities(per);
        l.splice(1, 1);
        writeQuantities(per, l);
      });
      expect(statuses(valueOf(useWorkspace.getState().ws))).toEqual(["BURN:potency", "TREMOR:potency", "RUPTURE:count"]);
      useWorkspace.getState().undo();
      expect(statuses(valueOf(useWorkspace.getState().ws))).toEqual(expected);
      edit((d) => void (valueOf(d as never).per = null));
      expect(valueOf(useWorkspace.getState().ws).per).toBeNull();
      useWorkspace.getState().undo();
      expect(statuses(valueOf(useWorkspace.getState().ws))).toEqual(expected);
      // and the restored data still passes the loader
      expect(statuses(valueOf(zWorkspace.parse(JSON.parse(JSON.stringify(useWorkspace.getState().ws)))))).toEqual(expected);
      vi.clearAllTimers();
    });
  });
  it("keeps the existing share and decoded size limits, even for a worst-case workspace", () => {
    expect(MAX_SHARE_CHARS).toBe(4_000_000);
    expect(MAX_DECODED_CHARS).toBe(16_000_000);
    // many values with the maximum quantities, with distinct status names so it compresses poorly
    const ws = emptyWorkspace();
    const id = newIdentity({ name: "Heavy" });
    const sk = skill("S", "WRATH", "SLASH", 4, 4, 1);
    const actions = Array.from({ length: 400 }, (_, i) =>
      mod("coinPower", perOf(Array.from({ length: 5 }, (_, j) => st(`STATUS_${i}_${j}_${Math.random().toString(36).slice(2)}`)), 3)),
    );
    onCoin(sk, 0, eff("onHit", actions));
    id.skills[0] = sk;
    ws.identities.push(id);
    const json = JSON.stringify(ws);
    expect(json.length).toBeLessThan(MAX_DECODED_CHARS);
    const code = encodeShareCode(itemsPayload(ws.identities));
    expect(code.length).toBeLessThan(MAX_SHARE_CHARS);
    const back = decodeShareCode(code) as { items: { skills: { coins: { effects: { actions: { amount: Value }[] }[] }[] }[] }[] };
    expect(readQuantities(back.items[0].skills[0].coins[0].effects[0].actions[399].amount.per!)).toHaveLength(5);
    // an oversized code is still refused by the unchanged limit
    expect(decodeShareCode("SW1:" + "A".repeat(MAX_SHARE_CHARS + 1))).toBeNull();
    // hostile 10,000-extras value inside a share code loads and is cut
    const junk = [5, null, "x", [1], { kind: 3 }, undefined];
    const extras = Array.from({ length: 10_000 }, (_, i) => (i % 3 === 0 ? rq("H" + i) : junk[i % junk.length]));
    const evil = JSON.parse(JSON.stringify(ws.identities[0]));
    evil.skills[0].coins[0].effects[0].actions[0].amount = rawVal([rq("A"), rq("B"), ...extras]);
    const imported = importAny(encodeShareCode({ format: "sinners-workshop/items", items: [evil] }));
    expect(imported.items.length).toBe(1);
    const amount = valueOf({ identities: imported.items as never });
    expect(readQuantities(amount.per!).length).toBeLessThanOrEqual(MAX_QUANTITIES);
    // { kind: 3 } is a valid entry (bad fields fall back to defaults), so it is kept as the third extra
    expect(readQuantities(amount.per!).map((x) => x.status)).toEqual(["A", "B", "H0", "H3", "BURN"]);
  });
});

describe("builder rules", () => {
  it("finds duplicates by what is counted, not by the label", () => {
    const list = [st("BURN"), st("BLEED"), st("BURN", { who: "self" })];
    expect(hasDuplicates(list)).toBe(false);
    expect(duplicateOf([...list, st("BURN")], 3)).toBe(0);
    expect(duplicateOf([st("BURN"), st("BURN", { kind: "statusCount" })], 1)).toBe(-1);
    expect(quantityKey(st("BURN"))).not.toBe(quantityKey(st("BLEED")));
  });
  it("suggests a new quantity that is not a repeat", () => {
    let list: Quantity[] = [];
    for (let i = 0; i < 5; i++) {
      list = [...list, nextQuantity(list)];
      expect(hasDuplicates(list)).toBe(false);
    }
  });
  it("uses consistent wording", () => {
    expect(addedMessage(3)).toBe("Quantity 3 added. 3 quantities, up to 5.");
    expect(removedMessage(2, 3)).toBe("Quantity 2 removed. 3 quantities left. Undo available.");
    expect(LIMIT_TEXT).toBe("Limit of 5 quantities reached");
  });
});


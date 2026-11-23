// Removes fields that equal the schema defaults, so the JSON stays small.
// The app restores them with the same zod schemas (parse fills defaults).
import {
  newCoin, zAction, zCondition, zCustomStatus, zEffect, zEgo, zEnemy, zGift, zIdentity, zPart, zPassive, zQuantity, zSkill,
} from "../../src/data/schema";

type Obj = Record<string, unknown>;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const D = {
  quantity: zQuantity.parse({ kind: "statusPotency" }) as Obj,
  value: { base: 0, per: null, min: null, max: null } as Obj,
  condition: zCondition.parse({ kind: "compare" }) as Obj,
  action: zAction.parse({ kind: "note" }) as Obj,
  effect: zEffect.parse({ trigger: "onHit", id: "x" }) as Obj,
  coin: newCoin() as unknown as Obj,
  skill: zSkill.parse({ id: "x" }) as Obj,
  passive: zPassive.parse({ id: "x" }) as Obj,
  part: zPart.parse({ id: "x" }) as Obj,
  identity: zIdentity.parse({ id: "x" }) as Obj,
  ego: zEgo.parse({ id: "x" }) as Obj,
  enemy: zEnemy.parse({ id: "x" }) as Obj,
  gift: zGift.parse({ id: "x" }) as Obj,
  status: zCustomStatus.parse({ id: "x" }) as Obj,
};
const KEEP = new Set(["id", "kind", "trigger", "name"]);

function strip(o: Obj, def: Obj, nested: Record<string, (v: unknown) => unknown> = {}): Obj {
  const out: Obj = {};
  for (const [k, v] of Object.entries(o)) {
    const nv = nested[k] ? nested[k](v) : v;
    if (!KEEP.has(k) && k in def && same(nv, def[k])) continue;
    out[k] = nv;
  }
  return out;
}
const arr = (f: (x: Obj) => Obj) => (v: unknown) => (Array.isArray(v) ? v.map((x) => f(x as Obj)) : v);
const opt = (f: (x: Obj) => Obj) => (v: unknown) => (v && typeof v === "object" ? f(v as Obj) : v);

const quantity = (q: Obj) => strip(q, D.quantity);
const value = (v: Obj) => strip(v, D.value, { per: opt((p) => ({ ...p, q: quantity(p.q as Obj) })) });
const condition = (c: Obj) => strip(c, D.condition, { q: opt(quantity) });
const action = (a: Obj) => strip(a, D.action, { potency: opt(value), amount: opt(value) });
const effect = (e: Obj) => strip(e, D.effect, { conditions: arr(condition), actions: arr(action) });
const coin = (c: Obj) => strip(c, D.coin, { effects: arr(effect) });
const skill = (s: Obj) => strip(s, D.skill, { coins: arr(coin), effects: arr(effect) });
const passive = (p: Obj) => strip(p, D.passive, { effects: arr(effect) });
const part = (p: Obj) => strip(p, D.part, { skills: arr(skill) });

export const compactIdentity = (x: Obj) => strip(x, D.identity, { skills: arr(skill), defense: arr(skill), passives: arr(passive) });
export const compactEgo = (x: Obj) => strip(x, D.ego, { awakening: opt(skill), corrosion: opt(skill), passive: opt(passive) });
export const compactEnemy = (x: Obj) => strip(x, D.enemy, { skills: arr(skill), passives: arr(passive), parts: arr(part) });
export const compactGift = (x: Obj) => strip(x, D.gift, { effects: arr(effect), plus1: opt((v) => v), plus2: opt((v) => v) });
export const compactStatus = (x: Obj) => strip(x, D.status, { effects: arr(effect) });
export function compactGiftDeep(x: Obj): Obj {
  const g = compactGift(x);
  for (const k of ["plus1", "plus2"]) if (Array.isArray(g[k])) g[k] = (g[k] as Obj[]).map(effect);
  if (Array.isArray(g.effects)) g.effects = (g.effects as Obj[]).map(effect);
  return g;
}

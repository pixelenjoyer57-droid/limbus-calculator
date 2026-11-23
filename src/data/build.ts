// Tiny builders so templates and tests can describe content in one line each.
import type { DmgType, Sin } from "../engine/constants";
import {
  newCoin, zAction, zCondition, zEffect, zSkill, val, type Action, type Condition, type Effect, type ModStat, type Quantity,
  type Skill, type Trigger, type Value, type Who, zQuantity,
} from "./schema";

export const q = (kind: Quantity["kind"], extra: Partial<Quantity> = {}): Quantity => zQuantity.parse({ kind, ...extra });

/** "base, plus `amount` for every `every` of quantity, capped at max" */
export const per = (quantity: Quantity, every: number, amount: number, max: number | null = null, base = 0): Value => ({
  base,
  per: { q: quantity, q2: null, every, amount },
  min: null,
  max,
});

export const eff = (trigger: Trigger, actions: Action[], conditions: Condition[] = [], extra: Partial<Effect> = {}): Effect =>
  zEffect.parse({ trigger, actions, conditions, ...extra });

export const act = (kind: Action["kind"], extra: Partial<Action> = {}): Action => zAction.parse({ kind, ...extra });

export const inflict = (status: string, potency: number | Value, count: number | Value = 0, who: Who = "target", timing: "now" | "nextTurn" = "now"): Action =>
  act("inflict", {
    status,
    potency: typeof potency === "number" ? val(potency) : potency,
    amount: typeof count === "number" ? val(count) : count,
    who,
    timing,
  });

/** Value statuses (Fragile, Haste, Damage Up ...) use a single amount. */
export const give = (status: string, amount: number | Value, who: Who = "target", timing: "now" | "nextTurn" = "now"): Action =>
  act("inflict", { status, potency: val(0), amount: typeof amount === "number" ? val(amount) : amount, who, timing });

export const mod = (stat: ModStat, amount: number | Value, extra: Partial<Action> = {}): Action =>
  act("mod", { stat, amount: typeof amount === "number" ? val(amount) : amount, who: "self", ...extra });

export const cond = (kind: Condition["kind"], extra: Partial<Condition> = {}): Condition => zCondition.parse({ kind, ...extra });

export const coins = (n: number, kind: "normal" | "unbreakable" | "excision" = "normal") =>
  Array.from({ length: n }, () => newCoin(kind));

export function skill(
  name: string,
  sin: Sin | null,
  dmgType: DmgType,
  basePower: number,
  coinPower: number,
  nCoins: number,
  extra: Partial<Skill> = {},
): Skill {
  return zSkill.parse({ name, sin, dmgType, basePower, coinPower, coins: coins(nCoins), ...extra });
}

/** Attach effects to coin `i` (0-based) of a skill. */
export function onCoin(s: Skill, i: number, ...effects: Effect[]): Skill {
  s.coins[i].effects.push(...effects);
  return s;
}

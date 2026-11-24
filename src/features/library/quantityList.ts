// Pure helpers for the "Scales with something" editor: the list of quantities a value adds up.
// Kept apart from the component so the rules (limit, duplicates, wording) can be tested without a browser.
import { MAX_QUANTITIES, type Quantity } from "../../data/schema";
import { QUANTITY_NEEDS } from "../../engine/describe";

export { MAX_QUANTITIES };

/** Same key means the same thing is counted: kind plus whichever of status, field, whom and sin that kind uses. */
export function quantityKey(q: Quantity): string {
  const needs = QUANTITY_NEEDS[q.kind] ?? [];
  return [q.kind, needs.includes("status") ? q.status : "", needs.includes("field") ? q.field : "", needs.includes("who") ? q.who : "", needs.includes("sin") ? q.sin : ""].join("|");
}

/** Index of another quantity that counts the same thing as list[index], or -1. */
export function duplicateOf(list: Quantity[], index: number): number {
  const key = quantityKey(list[index]);
  return list.findIndex((x, i) => i !== index && quantityKey(x) === key);
}

export function hasDuplicates(list: Quantity[]): boolean {
  const seen = new Set<string>();
  for (const q of list) {
    const k = quantityKey(q);
    if (seen.has(k)) return true;
    seen.add(k);
  }
  return false;
}

const SUGGESTED = ["BURN", "BLEED", "TREMOR", "RUPTURE", "SINKING", "POISE", "CHARGE"];

/** A new quantity that does not repeat one already in the list (the first unused keyword status). */
export function nextQuantity(list: Quantity[]): Quantity {
  const base: Quantity = { kind: "statusPotency", who: "target", status: "BURN", field: "potency", sin: "WRATH" };
  for (const status of SUGGESTED) {
    const q = { ...base, status };
    if (!list.some((x) => quantityKey(x) === quantityKey(q))) return q;
  }
  return base;
}

const plural = (n: number) => `${n} ${n === 1 ? "quantity" : "quantities"}`;

export const LIMIT_TEXT = `Limit of ${MAX_QUANTITIES} quantities reached`;
export const addedMessage = (n: number) => `Quantity ${n} added. ${plural(n)}, up to ${MAX_QUANTITIES}.`;
export const removedMessage = (n: number, left: number) => `Quantity ${n} removed. ${left} ${left === 1 ? "quantity" : "quantities"} left. Undo available.`;
export const duplicateMessage = (n: number, other: number) => `Quantity ${n} was not changed: quantity ${other} already counts that.`;
export const OLD_DUPLICATE_NOTE = "Two quantities count the same thing, so it is counted twice. This is allowed for older data.";
export const groupName = (n: number, of: number) => `Quantity ${n} of ${of}`;

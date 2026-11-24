// Markup checks for the quantity editor, rendered on the server (no browser is available in tests).
// Clicks, focus moves and announcements follow the pure rules in quantityList and are checked by hand.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { writeQuantities, zQuantity, type Quantity, type Value } from "../src/data/schema";
import { ValueEditor } from "../src/features/library/rules";

const st = (status: string): Quantity => zQuantity.parse({ kind: "statusPotency", who: "target", status });
const value = (statuses: string[]): Value => {
  const per = { q: st(statuses[0]), q2: null, every: 3, amount: 1 } as NonNullable<Value["per"]>;
  writeQuantities(per, statuses.map(st));
  return { base: 0, per, min: null, max: null };
};
const html = (v: Value) => renderToStaticMarkup(createElement(ValueEditor, { label: "Coin Power", v, edit: () => {} }));

describe("quantity editor markup", () => {
  it("shows labelled groups, names that include the group, and Remove with visible text", () => {
    const out = html(value(["BURN", "BLEED", "TREMOR"]));
    expect(out.match(/<fieldset/g)).toHaveLength(3);
    expect(out).toContain("Quantity 1 of 3");
    expect(out).toContain("Quantity 3 of 3");
    expect(out).toContain("Quantity 2: status");
    expect(out).toContain("Quantity 3: of whom");
    expect(out).toContain("Remove quantity 2");
    expect(out).toContain("Remove quantity 3");
    expect(out).not.toContain("Remove quantity 1");
    expect(out).toContain("Add another quantity");
    expect(out).not.toContain("Limit of 5");
    expect(out).not.toContain('aria-disabled="true"');
  });
  it("at the limit the Add button stays reachable, says why, and is linked to the reason", () => {
    const out = html(value(["A", "B", "C", "D", "E"]));
    expect(out).toContain("Limit of 5 quantities reached");
    expect(out).toContain('aria-disabled="true"');
    expect(out).not.toMatch(/<button[^>]*add another[^>]*disabled=""/i);
    const id = /aria-describedby="([^"]+)"[^>]*>(?:<svg.*?<\/svg>)?Add another quantity/.exec(out)?.[1];
    expect(id).toBeTruthy();
    expect(out).toContain(`id="${id}"`);
  });
  it("shows a gentle note, not an error, for repeated data", () => {
    const out = html(value(["BURN", "BURN"]));
    expect(out).toContain("counted twice");
    expect(out).not.toContain('role="alert"');
  });
  it("renders a hostile status name as text", () => {
    const name = "<img src=x onerror=alert(1)>";
    const out = html(value([name, "BLEED"]));
    expect(out).not.toContain("<img src=x");
    expect(out).toContain("Quantity 1: status");
  });
});

// @ts-ignore node types are not installed; vitest runs in Node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/* Guard for theme contrast. It reads the colour tokens from src/styles.css, builds the
   cascade for each theme, and checks named colour pairs with the WCAG formula.
   Text pairs need 4.5:1, UI parts and graphics 3:1. It checks token pairs, not every
   rendered element; the accessibility scan covers rendered pages. */

const css = readFileSync("src/styles.css", "utf8");

type RGB = [number, number, number];
type Tokens = Record<string, string>;

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Declarations of the rule with exactly this selector. Loud if it is missing. */
function block(selector: string, required = true): Tokens {
  const m = new RegExp(`(?:^|\\n)\\s*${esc(selector)}\\s*\\{([^}]*)\\}`).exec(css);
  if (!m) {
    if (required) throw new Error(`styles.css: rule not found: ${selector}`);
    return {};
  }
  const out: Tokens = {};
  for (const d of m[1].matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) out[d[1]] = d[2].trim();
  return out;
}

export function parseColor(v: string): { rgb: RGB; a: number } {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = [...h].map((c) => c + c).join("");
    return { rgb: [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB, a: 1 };
  }
  const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(v);
  if (rgba) return { rgb: [+rgba[1], +rgba[2], +rgba[3]], a: rgba[4] === undefined ? 1 : +rgba[4] };
  throw new Error(`Cannot read colour: ${v}`);
}

export function luminance([r, g, b]: RGB): number {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function ratio(a: RGB, b: RGB): number {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const over = (top: { rgb: RGB; a: number }, base: RGB): RGB =>
  top.rgb.map((v, i) => v * top.a + base[i] * (1 - top.a)) as RGB;

const root = block(":root");
const media = block(':root:not([data-theme="dark"])');
const light = block(':root[data-theme="light"]');
const high = block(':root[data-contrast="high"]');
const lightHigh = block(':root[data-theme="light"][data-contrast="high"]');
const mediaHigh = block(':root[data-contrast="high"]:not([data-theme="dark"])', false);
// The light on-gold label is set in the light blocks (white) and read from there.

const themes: Record<string, Tokens> = {
  dark: { ...root },
  "dark-high": { ...root, ...high },
  light: { ...root, ...light },
  "device-light": { ...root, ...media },
  "light-high": { ...root, ...light, ...lightHigh },
  // Same order the browser applies them for a light device with high contrast on.
  "device-light-high": { ...root, ...media, ...high, ...mediaHigh },
};

const COLOR_TOKENS = ["bg", "bg-2", "panel", "panel-2", "line", "line-soft", "text", "text-2", "muted", "gold", "gold-soft", "focus", "on-gold"];

function color(theme: string, token: string) {
  const v = themes[theme][token];
  if (v === undefined) throw new Error(`${theme}: missing token --${token}`);
  return parseColor(v);
}
const solid = (theme: string, token: string): RGB => color(theme, token).rgb;
/** A token, or "tint@<surface>" = the gold tint over that surface. */
function resolve(theme: string, spec: string): RGB {
  const m = /^tint@(.+)$/.exec(spec);
  return m ? over(color(theme, "gold-soft"), solid(theme, m[1])) : solid(theme, spec);
}

const SURFACES = ["bg", "bg-2", "panel", "panel-2"];
const TINTS = SURFACES.map((s) => `tint@${s}`);

type Pair = { name: string; fg: string; bg: string; min: number; themes?: string[] };
const pairs: Pair[] = [];
const text = (fg: string, bgs: string[], name = fg) => bgs.forEach((bg) => pairs.push({ name: `${name} on ${bg}`, fg, bg, min: 4.5 }));
["text", "text-2", "muted", "gold"].forEach((t) => text(t, SURFACES));
// Gold text on the gold tint: active link, bottom-bar item, selected tab and segmented button.
text("gold", TINTS);
// Selected list item: name and subtitle, plus other text that can sit on the tint.
["text", "text-2", "muted"].forEach((t) => text(t, TINTS));
// Label on gold fills (gold button, skip link).
pairs.push({ name: "on-gold on gold (button and skip link)", fg: "on-gold", bg: "gold", min: 4.5 });
// UI parts and graphics, 3:1.
const ui = (fg: string, bgs: string[]) => bgs.forEach((bg) => pairs.push({ name: `${fg} on ${bg} (UI)`, fg, bg, min: 3 }));
ui("focus", ["bg", "bg-2", "panel", "panel-2"]);
// Focus ring on gold fills is two-tone: an inner ring in the label colour, then the focus colour.
ui("on-gold", ["gold"]);
ui("focus", ["on-gold"]);
// Gold bars, histogram, coin dots, outlines, checkbox accent.
ui("gold", SURFACES);
// Borders: in the standard themes controls are identified by their labels; the
// high-contrast themes must show their lines at 3:1.
for (const t of ["dark-high", "light-high", "device-light-high"]) {
  ["bg", "panel"].forEach((bg) => pairs.push({ name: `line on ${bg} (UI)`, fg: "line", bg, min: 3, themes: [t] }));
}

describe("contrast helper", () => {
  it("computes known ratios", () => {
    expect(ratio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(ratio([255, 255, 255], [255, 255, 255])).toBeCloseTo(1, 5);
    expect(ratio([119, 119, 119], [255, 255, 255])).toBeCloseTo(4.48, 2);
    expect(parseColor("#fff").rgb).toEqual([255, 255, 255]);
    expect(parseColor("rgba(138, 93, 0, 0.1)")).toEqual({ rgb: [138, 93, 0], a: 0.1 });
    expect(() => parseColor("var(--x)")).toThrow();
  });
});

describe("theme tokens", () => {
  for (const theme of Object.keys(themes)) {
    it(`${theme} has every colour token`, () => {
      for (const t of COLOR_TOKENS) expect(themes[theme][t], `${theme}: missing --${t}`).toBeDefined();
    });
  }

  it("device-light matches the explicit light theme", () => {
    for (const t of Object.keys({ ...media, ...light })) {
      expect(media[t], `--${t} differs between device-light and light`).toBe(light[t]);
    }
  });

  it("device-light with high contrast matches light with high contrast", () => {
    for (const t of COLOR_TOKENS) {
      expect(themes["device-light-high"][t], `--${t} differs`).toBe(themes["light-high"][t]);
    }
  });

  it("the dark theme keeps its high-contrast muted colour", () => {
    expect(high.muted).toBe("#d3cbd9");
  });
});

describe("contrast guard", () => {
  for (const theme of Object.keys(themes)) {
    it(`${theme}: every listed pair reaches its minimum`, () => {
      const fails: string[] = [];
      for (const p of pairs) {
        if (p.themes && !p.themes.includes(theme)) continue;
        const r = ratio(resolve(theme, p.fg), resolve(theme, p.bg));
        if (r < p.min) fails.push(`${theme}: ${p.name} is ${r.toFixed(2)}:1, needs ${p.min}:1`);
      }
      expect(fails).toEqual([]);
    });
  }
});

describe("labels on gold use the shared token", () => {
  const rule = (sel: string) => new RegExp(`(?:^|\\n)\\s*${esc(sel)}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
  it("the gold button and the skip link use --on-gold, not a fixed colour", () => {
    expect(rule(".btn.gold")).toMatch(/color:\s*var\(--on-gold\)/);
    expect(rule(".skip-link")).toMatch(/color:\s*var\(--on-gold\)/);
  });
  it("the gold button stays recognisable when disabled", () => {
    expect(rule(".btn:disabled")).toMatch(/opacity:\s*0\.5/);
    expect(rule(".btn:disabled")).toMatch(/cursor:\s*not-allowed/);
  });
});

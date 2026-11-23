// Small wikitext template parser: enough for the wiki's data templates
// ({{IDPage}}, {{Skill}}, {{Passive}} …) with nesting, links and comments.

export interface Template {
  name: string;
  /** Named parameters (trimmed raw wikitext). */
  params: Record<string, string>;
  /** Positional parameters (trimmed raw wikitext), 1-based order. */
  pos: string[];
  raw: string;
}

export function stripComments(s: string): string {
  return s.replace(/<!--[\s\S]*?(-->|$)/g, "");
}

/** Find the end index (exclusive) of a `{{…}}` starting at i (s[i..i+1] === "{{"). */
function matchBraces(s: string, i: number): number {
  let depth = 0;
  let j = i;
  while (j < s.length) {
    if (s.startsWith("{{", j)) {
      depth++;
      j += 2;
    } else if (s.startsWith("}}", j)) {
      depth--;
      j += 2;
      if (depth === 0) return j;
    } else j++;
  }
  return s.length;
}

/** Split template inner text on top-level pipes (ignoring pipes inside {{ }} and [[ ]]). */
function splitPipes(inner: string): string[] {
  const parts: string[] = [];
  let cur = "";
  let brace = 0;
  let link = 0;
  for (let j = 0; j < inner.length; j++) {
    if (inner.startsWith("{{", j)) {
      brace++;
      cur += "{{";
      j++;
    } else if (inner.startsWith("}}", j) && brace > 0) {
      brace--;
      cur += "}}";
      j++;
    } else if (inner.startsWith("[[", j)) {
      link++;
      cur += "[[";
      j++;
    } else if (inner.startsWith("]]", j) && link > 0) {
      link--;
      cur += "]]";
      j++;
    } else if (inner[j] === "|" && brace === 0 && link === 0) {
      parts.push(cur);
      cur = "";
    } else cur += inner[j];
  }
  parts.push(cur);
  return parts;
}

export function parseTemplateAt(s: string, i: number): { t: Template; end: number } {
  const end = matchBraces(s, i);
  const raw = s.slice(i, end);
  const inner = raw.slice(2, -2);
  const parts = splitPipes(inner);
  const name = (parts.shift() ?? "").trim().replace(/_/g, " ");
  const params: Record<string, string> = {};
  const pos: string[] = [];
  for (const p of parts) {
    const eq = p.indexOf("=");
    // "=" inside a nested template/link does not make a named parameter
    const before = eq >= 0 ? p.slice(0, eq) : "";
    if (eq >= 0 && !before.includes("{{") && !before.includes("[[") && /^[\s\w\-. ]+$/.test(before)) {
      params[before.trim().toLowerCase()] = p.slice(eq + 1).trim();
    } else pos.push(p.trim());
  }
  return { t: { name, params, pos, raw }, end };
}

/** Top-level templates in a piece of wikitext, in order. */
export function templates(s: string): Template[] {
  const out: Template[] = [];
  let i = 0;
  while (i < s.length) {
    const k = s.indexOf("{{", i);
    if (k < 0) break;
    if (s.startsWith("{{{", k)) {
      i = k + 3;
      continue;
    }
    const { t, end } = parseTemplateAt(s, k);
    out.push(t);
    i = end;
  }
  return out;
}

/** Every template (any depth) whose name matches. */
export function findAll(s: string, name: string | RegExp): Template[] {
  const out: Template[] = [];
  const test = (n: string) => (typeof name === "string" ? n.toLowerCase() === name.toLowerCase() : name.test(n));
  const walk = (text: string) => {
    for (const t of templates(text)) {
      if (test(t.name)) out.push(t);
      walk(t.raw.slice(2, -2));
    }
  };
  walk(stripComments(s));
  return out;
}

export function findFirst(s: string, name: string | RegExp): Template | undefined {
  return findAll(s, name)[0];
}

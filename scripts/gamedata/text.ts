// Wikitext → plain game text. Keeps status names as written ("Burn", "Sinking"),
// trigger labels in square brackets ("[On Hit]") and line breaks.
import { parseTemplateAt, stripComments } from "./wikitext";

function renderTemplate(name: string, pos: string[], params: Record<string, string>, mark: boolean): string {
  const n = name.toLowerCase();
  const p = (i: number) => clean(pos[i] ?? "", mark);
  switch (n) {
    case "statuseffect": {
      const nm = p(0);
      return mark && nm && !/^(slash|pierce|blunt)$/i.test(nm) ? `⟦${nm}⟧` : nm;
    }
    case "keyword":
    case "skillhint":
    case "charcon":
    case "giftt":
    case "gifttt":
    case "colortext2":
      return p(0);
    case "skillcon":
      return `[${p(0)}]`;
    case "statcon": {
      const kind = (pos[0] ?? "").trim();
      const v = p(1);
      if (kind === "hpheal" || kind === "hplose") return `${v} HP`;
      if (kind === "spheal" || kind === "splose") return `${v} SP`;
      if (kind === "minsp") return "SP to minimum value";
      if (kind.startsWith("sin")) return `${kind.slice(3, 4).toUpperCase()}${kind.slice(4)} Sin Affinity Attack Skill`;
      return v;
    }
    case "colortext":
      return p(pos.length - 1);
    case "icons":
      return "";
    case "!":
      return "|";
    case "ryoshu":
      return "Ryōshū";
    case "rootpagename":
      return "";
    case "uptiecoin":
      return `(Coin ${p(0)}) ${p(1)}`;
    default:
      if (n.startsWith("#") || n.startsWith("displaytitle")) return "";
      return pos.length ? p(0) : Object.values(params).map((x) => clean(x, mark)).join(" ");
  }
}

/** `mark`: wrap status names as ⟦Name⟧ for the effect parser. */
export function clean(src: string, mark = false): string {
  let s = stripComments(src ?? "");
  // templates (innermost handled by recursion in renderTemplate)
  let out = "";
  let i = 0;
  while (i < s.length) {
    const k = s.indexOf("{{", i);
    if (k < 0) {
      out += s.slice(i);
      break;
    }
    out += s.slice(i, k);
    const { t, end } = parseTemplateAt(s, k);
    out += renderTemplate(t.name, t.pos, t.params, mark);
    i = end;
  }
  s = out;
  s = s
    .replace(/\[\[(?:File|Image):[^\]]*\]\]/gi, "")
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2")
    .replace(/\[\[([^\]]*)\]\]/g, "$1")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(span|font|b|i|u|small|big|div|sup|sub|s|center|nowiki|ab)[^>]*>/gi, "")
    .replace(/'''|''/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return s;
}

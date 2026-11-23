// Wiki pages → simulator content (same shape as user content, ids prefixed "g:").
import {
  newCoin, zCustomStatus, zEgo, zEnemy, zGift, zIdentity,
  type Coin, type CustomStatus, type Ego, type Effect, type Enemy, type Gift, type Identity, type Part, type Passive, type Skill, type SkillKind,
} from "../../src/data/schema";
import { SINNERS, type DmgType, type Sin, type Sinner } from "../../src/engine/constants";
import { convert, type Converted, type Where } from "./effects";
import { clean } from "./text";
import { findAll, findFirst, stripComments, templates, type Template } from "./wikitext";
import type { StatusRegistry } from "./statuses";
import type { LuaTable } from "./lua";

export const MAX_LEVEL = 65;
const SIN_OF: Record<string, Sin> = { wrath: "WRATH", lust: "LUST", sloth: "SLOTH", gluttony: "GLUTTONY", gloom: "GLOOM", pride: "PRIDE", envy: "ENVY" };
const DMG_OF: Record<string, DmgType> = { slash: "SLASH", pierce: "PIERCE", penetrate: "PIERCE", blunt: "BLUNT", hit: "BLUNT" };
const RES_WORD: Record<string, number> = { fatal: 2, weak: 1.5, normal: 1, endure: 0.75, ineffective: 0.5, ineff: 0.5, immune: 0 };

export interface Stats {
  sentences: number;
  parsed: number;
  info: number;
}
export interface Source {
  page: string;
  /** e.g. "Canto V" or "Mirror of the Lake (Hard)" */
  location?: string;
}

export function slugify(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

const toNum = (v: string | undefined, d: number): number => {
  if (v === undefined) return d;
  const m = /[+-]?\s*\d+(?:\.\d+)?/.exec(clean(v).replace(/\s+/g, ""));
  return m ? Number(m[0].replace(/\s+/g, "")) : d;
};
const toInt = (v: string | undefined, d: number) => Math.round(toNum(v, d));
/** "+ 7" → 7, "- 3" → -3, "+7" → 7 */
const coinPowerOf = (v: string | undefined) => {
  const s = clean(v ?? "").replace(/\s+/g, "");
  const m = /^([+-]?)(\d+)/.exec(s);
  if (!m) return 0;
  return (m[1] === "-" ? -1 : 1) * Number(m[2]);
};
const speedOf = (v: string | undefined): [number, number] => {
  const m = /(\d+)\s*[~\-–]\s*(\d+)/.exec(clean(v ?? ""));
  if (m) return [Number(m[1]), Number(m[2])];
  const n = toInt(v, 3);
  return [n, n];
};
const sinOf = (v: string | undefined): Sin | null => SIN_OF[clean(v ?? "").trim().toLowerCase()] ?? null;
const resOf = (v: string | undefined, d = 1): number => {
  if (v === undefined || clean(v) === "") return d;
  const w = clean(v).trim().toLowerCase();
  if (w in RES_WORD) return RES_WORD[w];
  const n = Number(w.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && w.match(/\d/) ? Math.min(10, n) : d;
};
const sinResOf = (P: Record<string, string>, suffix = "") =>
  Object.fromEntries((["WRATH", "LUST", "SLOTH", "GLUTTONY", "GLOOM", "PRIDE", "ENVY"] as Sin[]).map((s) => [s, resOf(P[s.toLowerCase() + suffix])])) as Record<Sin, number>;
const thresholdsOf = (P: Record<string, string>) =>
  [1, 2, 3, 4, 5].map((i) => P[`stagger${i}`]).filter((x) => x !== undefined && /\d/.test(clean(x))).map((x) => toNum(x, 0)).filter((x) => x > 0 && x < 100);
const keywordsOf = (v: string | undefined): string[] => {
  if (!v) return [];
  const out = findAll(v, "Keyword").map((t) => clean(t.pos[0] ?? "")).filter(Boolean);
  return [...new Set(out)].slice(0, 20).map((x) => x.slice(0, 40));
};

// ---------------------------------------------------------------------------------
// notes
// ---------------------------------------------------------------------------------
function joinNotes(parts: string[], max = 2000): string {
  const lines = parts.map((x) => x.trim()).filter(Boolean);
  if (!lines.length) return "";
  let out = "Not simulated (shown for reference):\n" + lines.map((l) => "• " + l).join("\n");
  if (out.length > max) out = out.slice(0, max - 1) + "…";
  return out;
}

// ---------------------------------------------------------------------------------
// Converter wrapper with statistics
// ---------------------------------------------------------------------------------
export class Ctx {
  stats: Record<string, Stats> = {};
  /** bucket → normalised unparsed sentence → count (for the coverage report) */
  misses: Record<string, Map<string, number>> = {};
  constructor(public statuses: StatusRegistry) {}
  conv(text: string | undefined, where: Where, bucket: string): Converted {
    const r = convert(clean(text ?? "", true), where, this.statuses.lookup);
    const s = (this.stats[bucket] ??= { sentences: 0, parsed: 0, info: 0 });
    s.sentences += r.sentences;
    s.parsed += r.parsed;
    s.info += r.info;
    const m = (this.misses[bucket] ??= new Map());
    for (const n of r.notes) {
      const k = n.replace(/\d+(\.\d+)?/g, "N");
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return r;
  }
}

// ---------------------------------------------------------------------------------
// Skills & passives
// ---------------------------------------------------------------------------------
export function buildSkill(t: Template, c: Ctx, bucket: string, defaultAmount = 1): Skill {
  const P = t.params;
  const type = clean(P.type ?? "").trim().toLowerCase();
  let kind: SkillKind = type === "guard" || type === "defense" || type === "def" ? "guard" : type === "evade" ? "evade" : "attack";
  const dmgType: DmgType = DMG_OF[type] ?? "BLUNT";
  const se = c.conv(P.se, "skill", bucket);
  // coins
  let coinKinds: Coin["kind"][] = [];
  if (P.complexcoin && clean(P.complexcoin).trim()) {
    const parts = clean(P.complexcoin).split(",").map((x) => x.trim());
    for (let i = 0; i + 1 < parts.length; i += 2) {
      const k = parts[i].toLowerCase();
      const n = Math.max(0, Math.min(12, Number(parts[i + 1]) || 0));
      for (let j = 0; j < n; j++) coinKinds.push(k === "unbreakable" ? "unbreakable" : k === "excision" ? "excision" : "normal");
    }
  }
  const nCoins = coinKinds.length || Math.max(1, Math.min(12, toInt(P.coin, 1)));
  if (!coinKinds.length) coinKinds = Array.from({ length: nCoins }, () => "normal");
  const notes: string[] = [...se.notes];
  const coins: Coin[] = coinKinds.map((k, i) => {
    const ce = c.conv(P[`ce${i + 1}`], "coin", bucket);
    let kindI = k;
    if (ce.flags.unbreakable) kindI = "unbreakable";
    if (ce.flags.excision) kindI = "excision";
    for (const n of ce.notes) notes.push(`Coin ${i + 1}: ${n}`);
    return newCoin(kindI, { effects: ce.effects });
  });
  let clashable = false;
  if (se.flags.counter) {
    kind = "counter";
    clashable = true;
  }
  if (se.flags.clashable && kind === "guard") clashable = true;
  const levelMod = kind === "attack" ? toInt(P.atkmod, 0) : toInt(P.defmod ?? P.atkmod, 0);
  const skill: Skill = {
    id: "",
    name: clean(P.name ?? "Skill").slice(0, 80) || "Skill",
    kind,
    clashable,
    sin: sinOf(P.sin),
    dmgType,
    basePower: toInt(P.spower, 0),
    coinPower: coinPowerOf(P.cpower),
    coins,
    levelMod,
    atkWeight: Math.max(1, Math.min(12, toInt(P.atkweight, 1))),
    amount: Math.max(0, Math.min(9, toInt(P.amt, defaultAmount))),
    slot: null,
    unclashable: !!se.flags.unclashable,
    indiscriminate: !!se.flags.indiscriminate,
    effects: se.effects,
    notes: joinNotes(notes),
  };
  return skill;
}

function passiveReq(P: Record<string, string>): Pick<Passive, "reqMode" | "reqSin" | "reqCount"> {
  const sin = sinOf(P.sin);
  const req = clean(P.req ?? "");
  const n = toInt(req, 0);
  if (!sin || !n) return { reqMode: "none", reqSin: "WRATH", reqCount: 3 };
  return { reqMode: /own/i.test(req) ? "owned" : "res", reqSin: sin, reqCount: n };
}

export function buildPassive(t: Template, kind: Passive["kind"], c: Ctx, bucket: string): Passive {
  const name = clean(t.pos[0] ?? "Passive").slice(0, 80) || "Passive";
  const conv = c.conv(t.pos[1] ?? t.params["2"] ?? "", "passive", bucket);
  const req = passiveReq(t.params);
  const extra: string[] = [];
  if (t.params.sin2) extra.push(`Also needs ${clean(t.params.req2 ?? "")} ${clean(t.params.sin2)} (only the first requirement is checked).`);
  return {
    id: "",
    name,
    kind,
    ...req,
    effects: conv.effects,
    notes: joinNotes([...conv.notes, ...extra]),
  };
}

/** A parameter holding one or more {{Passive}} templates. */
function passivesIn(v: string | undefined, kind: Passive["kind"], c: Ctx, bucket: string): Passive[] {
  if (!v) return [];
  return findAll(v, "Passive").map((t) => buildPassive(t, kind, c, bucket));
}
function skillIn(v: string | undefined, c: Ctx, bucket: string, amount = 1, withSlot = false): Skill | null {
  if (!v) return null;
  const t = findFirst(v, /^(Skill|UptieSkills)$/i);
  if (!t) return null;
  const sk = buildSkill(t, c, bucket, amount);
  if (withSlot) {
    const lv = toInt(t.params.slevel, 0);
    if (lv >= 1 && lv <= 3) sk.slot = `S${lv}` as "S1" | "S2" | "S3";
  }
  return sk;
}

// ---------------------------------------------------------------------------------
// Deterministic ids for nested things (stable JSON between runs)
// ---------------------------------------------------------------------------------
function idEffects(list: Effect[], prefix: string) {
  list.forEach((e, i) => (e.id = `${prefix}e${i}`));
}
function idSkill(s: Skill, prefix: string) {
  s.id = prefix;
  idEffects(s.effects, prefix + ":");
  s.coins.forEach((c, i) => idEffects(c.effects, `${prefix}:c${i}:`));
}
function idPassive(p: Passive, prefix: string) {
  p.id = prefix;
  idEffects(p.effects, prefix + ":");
}

// ---------------------------------------------------------------------------------
// Identities
// ---------------------------------------------------------------------------------
const sinnerOf = (v: string | undefined): Sinner | null => {
  const s = clean(v ?? "").trim();
  if (/ryoshu|ryōshū/i.test(s) || /\{\{Ryoshu\}\}/.test(v ?? "")) return "Ryōshū";
  return (SINNERS as readonly string[]).includes(s) ? (s as Sinner) : null;
};

export function mapIdentity(title: string, text: string, c: Ctx): Identity | null {
  const t = findFirst(text, "IDPage");
  if (!t) return null;
  const P = t.params;
  const sinner = sinnerOf(P.sinner);
  if (!sinner) return null;
  const level = MAX_LEVEL;
  const hpBase = toNum(P.hp, 0);
  const growth = toNum(P.hpgrowth, 0);
  const [smin, smax] = speedOf(P.speed);
  const id = "g:id:" + slugify(title);
  const amounts = [3, 2, 1, 1, 1, 1];
  const skills = ["skill1", "skill2", "skill3", "skill4"].map((k, i) => skillIn(P[k], c, "identity", amounts[i], true)).filter((x): x is Skill => !!x);
  const defense = ["defense", "defense2", "defense3", "defense4"].map((k) => skillIn(P[k], c, "identity", 1)).filter((x): x is Skill => !!x);
  const passives = [...passivesIn(P.passive0, "combat", c, "identity"), ...passivesIn(P.passive1, "combat", c, "identity"), ...passivesIn(P.passive2, "support", c, "identity")];
  skills.forEach((s, i) => idSkill(s, `${id}:s${i}`));
  defense.forEach((s, i) => idSkill(s, `${id}:d${i}`));
  passives.forEach((p, i) => idPassive(p, `${id}:p${i}`));
  const idn: Identity = {
    id,
    kind: "identity",
    name: title.slice(0, 80),
    sinner,
    rarity: Math.max(1, Math.min(3, toInt(P.rarity, 3))),
    level,
    hp: Math.max(1, Math.round(hpBase + growth * level)),
    hpPerLevel: growth,
    speedMin: smin,
    speedMax: Math.max(smin, smax),
    defenseMod: toInt(P.defmod, 0),
    staggerThresholds: thresholdsOf(P),
    resist: { SLASH: resOf(P.slash), PIERCE: resOf(P.pierce), BLUNT: resOf(P.blunt) },
    skills: skills.slice(0, 6),
    defense: defense.slice(0, 4),
    passives: passives.slice(0, 8),
    traits: keywordsOf(P.keyword),
    notes: "Uptie 4 values from the wiki.",
    tags: ["game data"],
    source: title,
    createdAt: 0,
    updatedAt: 0,
  } as Identity;
  return zIdentity.parse(idn);
}

// ---------------------------------------------------------------------------------
// E.G.O
// ---------------------------------------------------------------------------------
export function mapEgo(title: string, text: string, c: Ctx): Ego | null {
  const t = findFirst(text, "EGPage");
  if (!t) return null;
  const P = t.params;
  const sinner = sinnerOf(P.sinner);
  const grade = clean(P.risk ?? "").trim().toUpperCase();
  if (!sinner || !["ZAYIN", "TETH", "HE", "WAW", "ALEPH"].includes(grade)) return null;
  const id = "g:ego:" + slugify(title);
  const awakening = skillIn(P.askill, c, "ego", 1);
  if (!awakening) return null;
  const corrosion = skillIn(P.cskill, c, "ego", 1);
  const passive = passivesIn(P.passive, "combat", c, "ego")[0] ?? null;
  idSkill(awakening, `${id}:a`);
  if (corrosion) idSkill(corrosion, `${id}:c`);
  if (passive) idPassive(passive, `${id}:p`);
  const cost = Object.fromEntries((["WRATH", "LUST", "SLOTH", "GLUTTONY", "GLOOM", "PRIDE", "ENVY"] as Sin[]).map((s) => [s, Math.max(0, toInt(P[s.toLowerCase() + "cost"], 0))]));
  const notes = ["Threadspin IV values from the wiki."];
  if (P.askill5) notes.push("A Threadspin V version exists on the wiki (not included).");
  const ego = {
    id,
    kind: "ego",
    name: title.slice(0, 80),
    sinner,
    grade,
    cost,
    spCost: Math.max(0, toInt(P.asanity, 0)),
    sinResist: sinResOf(P, "res"),
    awakening,
    corrosion,
    passive,
    notes: notes.join(" "),
    tags: ["game data", ...(sinOf(P.affinity) ? [clean(P.affinity)] : [])],
    source: title,
    createdAt: 0,
    updatedAt: 0,
  };
  return zEgo.parse(ego);
}

// ---------------------------------------------------------------------------------
// Enemies (human enemies, Abnormalities with parts, Peccatulum Invidiae)
// ---------------------------------------------------------------------------------
interface EnemyOut {
  enemy: Enemy;
  location: string;
}

function levelOf(P: Record<string, string>): number {
  const l = toInt(P.level, 0);
  return l > 0 ? l : MAX_LEVEL;
}

function numberedSkills(P: Record<string, string>, c: Ctx, max = 24): { skill: Skill; key: string }[] {
  const out: { skill: Skill; key: string }[] = [];
  for (let i = 1; i <= max; i++) {
    const s = skillIn(P[`skill${i}`], c, "enemy", 1);
    if (s) out.push({ skill: s, key: `skill${i}` });
  }
  return out;
}
function numberedPassives(P: Record<string, string>, c: Ctx, from = 0, max = 16): Passive[] {
  const out: Passive[] = [];
  for (let i = from; i <= max; i++) out.push(...passivesIn(P[`passive${i}`], "combat", c, "enemy"));
  return out;
}

function mapHuman(t: Template, title: string, c: Ctx, invidiae = false): EnemyOut | null {
  const P = t.params;
  let name = clean(P.name ?? "").trim();
  if (invidiae) {
    const parts = [clean(P.prefix ?? ""), sinnerOf(P.sinner) ?? clean(P.sinner ?? ""), clean(P.suffix ?? "")].filter(Boolean).join(" ");
    name = `${clean(P.type ?? "Peccatulum Invidiae")} - ${parts}`.trim();
  }
  if (!name) name = title.replace(/\/Enemy.*$/, "");
  const level = levelOf(P);
  const hpBase = toNum(P.hp, 1);
  const growth = toNum(P.hpgrowth, 0);
  const [smin, smax] = speedOf(P.speed);
  const skills = numberedSkills(P, c).map((x) => x.skill);
  if (invidiae) for (const k of ["defense", "defense2", "defense3", "defense4"]) {
    const s = skillIn(P[k], c, "enemy", 1);
    if (s) skills.push(s);
  }
  if (!skills.length) return null;
  const passives = numberedPassives(P, c, 0);
  const waves = [P.wave1, P.wave2, P.wave3].map((w) => toInt(w, 0)).filter((n) => n > 0);
  const slots = waves[0] ?? 1;
  const maxActions = Math.max(slots, toInt(P.maxactions, 0), ...waves);
  const panic = clean(P.panic ?? "").trim();
  const hasSanity = !(/^(none|n\/a|-|no panic)$/i.test(panic) || P.nopanic !== undefined) && (panic !== "" || P.psanity !== undefined || P.nsanity !== undefined || invidiae);
  const enemy = {
    id: "",
    kind: "enemy",
    name: name.slice(0, 80),
    level,
    hp: Math.max(1, Math.round(hpBase + growth * level)),
    hpPerLevel: growth,
    speedMin: smin,
    speedMax: Math.max(smin, smax),
    defenseMod: toInt(P.defmod, 0),
    staggerThresholds: thresholdsOf(P),
    resist: { SLASH: resOf(P.slash), PIERCE: resOf(P.pierce), BLUNT: resOf(P.blunt) },
    sinResist: sinResOf(P),
    hasSanity,
    startSp: 0,
    panicRecovery: false,
    slots: Math.min(12, slots),
    slotsMax: Math.min(12, maxActions),
    pattern: "random",
    rotation: [],
    skills: skills.slice(0, 16),
    passives: passives.slice(0, 10),
    parts: [],
    notes: [panic ? `Panic Type: ${panic}.` : "", P.faction ? `Faction: ${clean(P.faction)}.` : ""].filter(Boolean).join(" "),
    tags: ["game data", ...keywordsOf(P.keyword)].slice(0, 30),
    source: title,
    createdAt: 0,
    updatedAt: 0,
  } as unknown as Enemy;
  return { enemy, location: clean(P.location ?? "") };
}

const BREAK: Record<string, Part["breakable"]> = { destroy: "destructible", sever: "severable", none: "indestructible" };

function mapAbno(t: Template, title: string, c: Ctx): EnemyOut | null {
  const P = t.params;
  const name = clean(P.name ?? "").trim() || title.replace(/\/Enemy.*$/, "");
  const level = levelOf(P);
  const parts: (Part & { _name: string })[] = [];
  for (let i = 1; i <= 8; i++) {
    const v = P[`abnoparts${i}`];
    if (!v) continue;
    const pt = findFirst(v, /^(ABPage\/Parts|AbnormalitiesParts)$/i);
    if (!pt) continue;
    const Q = pt.params;
    const plevel = toInt(Q.level, 0) > 0 ? toInt(Q.level, 0) : level;
    const growth = toNum(Q.hpgrowth, 0);
    const [smin, smax] = speedOf(Q.speed);
    const pname = clean(Q.partsname ?? `Part ${i}`).trim() || `Part ${i}`;
    parts.push({
      _name: pname,
      id: "",
      name: pname.slice(0, 60),
      hp: Math.max(1, Math.round(toNum(Q.hp, 1) + growth * plevel)),
      hpPerLevel: growth,
      defenseMod: toInt(Q.defmod, 0),
      resist: { SLASH: resOf(Q.slash), PIERCE: resOf(Q.pierce), BLUNT: resOf(Q.blunt) },
      sinResist: sinResOf(Q),
      breakable: BREAK[clean(Q.breaktype ?? "none").trim().toLowerCase()] ?? "indestructible",
      slots: 1,
      speedMin: smin,
      speedMax: Math.max(smin, smax),
      staggerThresholds: thresholdsOf(Q),
      skills: [],
    } as unknown as Part & { _name: string });
  }
  const skills = numberedSkills(P, c, 24);
  const passives = numberedPassives(P, c, 1);
  if (!skills.length && !parts.length) return null;
  // skills → parts by the "skillpartsN" label (part name)
  const loose: Skill[] = [];
  for (const { skill, key } of skills) {
    const label = clean(P[key.replace("skill", "skillparts")] ?? "").trim().toLowerCase();
    const part = parts.find((p) => label && (label === p._name.toLowerCase() || label.includes(p._name.toLowerCase()))) ?? (parts.length === 1 ? parts[0] : undefined);
    if (part) part.skills.push(skill);
    else loose.push(skill);
  }
  if (loose.length && parts.length) parts[0].skills.push(...loose);
  const hpBase = toNum(P.hp, 0);
  const growth = toNum(P.hpgrowth, 0);
  const first = parts[0];
  const enemy = {
    id: "",
    kind: "enemy",
    name: name.slice(0, 80),
    level,
    hp: Math.max(1, Math.round(hpBase + growth * level)),
    hpPerLevel: growth,
    speedMin: (first as any)?.speedMin ?? 1,
    speedMax: (first as any)?.speedMax ?? 1,
    defenseMod: first?.defenseMod ?? 0,
    staggerThresholds: [],
    resist: first ? { ...first.resist } : { SLASH: 1, PIERCE: 1, BLUNT: 1 },
    sinResist: first ? { ...first.sinResist } : sinResOf({}),
    hasSanity: false,
    startSp: 0,
    panicRecovery: false,
    slots: parts.length ? 0 : 1,
    slotsMax: parts.length ? 0 : 1,
    pattern: "random",
    rotation: [],
    skills: parts.length ? [] : loose.slice(0, 16),
    passives: passives.slice(0, 10),
    parts: parts.slice(0, 8).map(({ _name, ...p }) => ({ ...p, skills: p.skills.slice(0, 12) })),
    notes: [P.abnorisk ? `Risk: ${clean(P.abnorisk)}.` : "", P.abnocode ? `Code: ${clean(P.abnocode)}.` : ""].filter(Boolean).join(" "),
    tags: ["game data", "Abnormality", ...keywordsOf(P.keyword)].slice(0, 30),
    source: title,
    createdAt: 0,
    updatedAt: 0,
  } as unknown as Enemy;
  return { enemy, location: clean(P.location ?? "") };
}

/** All enemy variants on one wiki page. */
export function mapEnemyPage(title: string, text: string, c: Ctx): EnemyOut[] {
  const out: EnemyOut[] = [];
  const body = stripComments(text);
  for (const t of findAll(body, /^(ENPage|ENPage\/Invidiae|ABPage|ABInfo|AbnormalitiesInfo)$/i)) {
    const n = t.name.toLowerCase();
    const r = n === "enpage" ? mapHuman(t, title, c) : n === "enpage/invidiae" ? mapHuman(t, title, c, true) : mapAbno(t, title, c);
    if (r) {
      (r as any).gameId = clean(t.params.id ?? "").trim();
      out.push(r);
    }
  }
  return out;
}

export function finishEnemies(list: (EnemyOut & { gameId?: string })[]): Enemy[] {
  const seen = new Map<string, number>();
  const nameCount = new Map<string, number>();
  for (const x of list) nameCount.set(x.enemy.name, (nameCount.get(x.enemy.name) ?? 0) + 1);
  const out: Enemy[] = [];
  for (const x of list) {
    const e = x.enemy;
    const base = "g:en:" + (x.gameId && /^\d+$/.test(x.gameId) ? x.gameId : slugify(`${e.source}-${e.name}`));
    const k = seen.get(base) ?? 0;
    seen.set(base, k + 1);
    const id = k ? `${base}-${k + 1}` : base;
    e.id = id;
    if ((nameCount.get(e.name) ?? 0) > 1) {
      const where = x.location || `Lv ${e.level}`;
      e.name = `${e.name} (${where})`.slice(0, 80);
    }
    if (x.location) e.tags = [...e.tags, x.location.slice(0, 40)].slice(0, 30);
    e.skills.forEach((s, i) => idSkill(s, `${id}:s${i}`));
    e.passives.forEach((p, i) => idPassive(p, `${id}:p${i}`));
    e.parts.forEach((p, pi) => {
      p.id = `${id}:part${pi}`;
      p.skills.forEach((s, i) => idSkill(s, `${id}:part${pi}:s${i}`));
    });
    out.push(zEnemy.parse(e));
  }
  return out;
}

// ---------------------------------------------------------------------------------
// E.G.O Gifts (Module:EgoGift/data)
// ---------------------------------------------------------------------------------
const KEYWORD_OF: Record<string, Gift["keyword"]> = {
  burn: "BURN", bleed: "BLEED", tremor: "TREMOR", rupture: "RUPTURE", sinking: "SINKING", poise: "POISE", charge: "CHARGE",
  slash: "SLASH", pierce: "PIERCE", blunt: "BLUNT",
};

/** Section comments in the Lua module ("--MD5 / Mirror of the Dreaming") per gift key. */
export function giftSections(src: string): Map<string, string> {
  const out = new Map<string, string>();
  let section = "";
  for (const line of src.split("\n")) {
    const c = /^\s*-{2,}\s*(.+?)\s*$/.exec(line);
    if (c && !line.includes("=")) {
      const t = c[1].replace(/^\[|\]$/g, "");
      if (t.includes(" / ")) section = t.split(" / ").slice(1).join(" / ").trim();
      continue;
    }
    const k = /^\s*\["(.+?)"\]\s*=/.exec(line);
    if (k && section) out.set(k[1], section.slice(0, 40));
  }
  return out;
}

export function mapGifts(data: LuaTable, c: Ctx, sections = new Map<string, string>()): Gift[] {
  const entries = Object.entries(data) as [string, LuaTable][];
  const base = entries.filter(([k]) => !/\+$/.test(k));
  const nameCount = new Map<string, number>();
  for (const [k, g] of base) {
    const n = String(g.name ?? k);
    nameCount.set(n, (nameCount.get(n) ?? 0) + 1);
  }
  const out: Gift[] = [];
  const used = new Set<string>();
  for (const [key, g] of base) {
    const plus1 = data[key + "+"] as LuaTable | undefined;
    const plus2 = data[key + "++"] as LuaTable | undefined;
    const desc = typeof g.desc === "string" ? g.desc : "";
    const conv0 = c.conv(desc, "gift", "gift");
    const conv1 = plus1 && typeof plus1.desc === "string" ? c.conv(plus1.desc, "gift", "gift") : null;
    const conv2 = plus2 && typeof plus2.desc === "string" ? c.conv(plus2.desc, "gift", "gift") : null;
    let id = "g:gift:" + slugify(key);
    while (used.has(id)) id += "-";
    used.add(id);
    idEffects(conv0.effects, id + ":");
    if (conv1) idEffects(conv1.effects, id + ":p1:");
    if (conv2) idEffects(conv2.effects, id + ":p2:");
    const tier = typeof g.tier === "string" && ["I", "II", "III", "IV", "V", "EX"].includes(g.tier) ? g.tier : "I";
    const notes = [
      clean(desc),
      plus1 && typeof plus1.desc === "string" ? `+ version:\n${clean(plus1.desc)}` : "",
      plus2 && typeof plus2.desc === "string" ? `++ version:\n${clean(plus2.desc)}` : "",
      conv0.notes.length || conv1?.notes.length || conv2?.notes.length ? joinNotes([...conv0.notes, ...(conv1?.notes ?? []).map((n) => "(+) " + n), ...(conv2?.notes ?? []).map((n) => "(++) " + n)], 1500) : "",
    ].filter(Boolean).join("\n\n");
    const gift = {
      id,
      kind: "gift",
      name: ((nameCount.get(String(g.name ?? key)) ?? 0) > 1 ? key : String(g.name ?? key)).slice(0, 80),
      tier,
      keyword: KEYWORD_OF[String(g.category ?? "").toLowerCase()] ?? "NONE",
      cost: typeof g.cost === "number" ? Math.round(g.cost) : 0,
      scope: "eachAlly",
      effects: conv0.effects,
      plus1: conv1 ? conv1.effects : null,
      plus2: conv2 ? conv2.effects : null,
      notes: notes.slice(0, 4000),
      tags: [
        "game data",
        ...(typeof g.sin === "string" ? [g.sin[0].toUpperCase() + g.sin.slice(1)] : []),
        ...(sections.get(key) ? [sections.get(key)!] : []),
        ...(/legacy/i.test(key) ? ["Legacy"] : []),
        ...(typeof g.tier === "string" ? [] : ["No tier (story/other)"]),
      ],
      source: "Module:EgoGift/data",
      createdAt: 0,
      updatedAt: 0,
    };
    out.push(zGift.parse(gift));
  }
  return out;
}

// ---------------------------------------------------------------------------------
// Every wiki status (so custom kits can use them too)
// ---------------------------------------------------------------------------------
export function allStatuses(data: LuaTable, reg: StatusRegistry): CustomStatus[] {
  for (const name of Object.keys(data)) reg.lookup(name);
  return reg.gameStatuses().map((s) => zCustomStatus.parse({ ...s, source: "Module:StatusEffect/data" }));
}

export function templateNames(text: string): string[] {
  return templates(stripComments(text)).map((t) => t.name);
}

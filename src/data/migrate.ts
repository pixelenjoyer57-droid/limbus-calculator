// Turning unknown JSON (exports, share codes, the old one-file Sinner's Workshop)
// into valid content. Never throws: invalid parts are repaired or dropped.
import LZString from "lz-string";
import { SINNERS, type DmgType, type Sin } from "../engine/constants";
import {
  COLLECTION, SCHEMA_BY_KIND, SCHEMA_VERSION, newId, zWorkspace, type AnyContent, type ContentKind, type Workspace,
} from "./schema";
import { newEnemy, newIdentity, newSkill } from "./defaults";

/** The in-game data keys (used by the old file) mapped to sin names. */
const OLD_SIN: Record<string, Sin> = {
  CRIMSON: "WRATH", SCARLET: "LUST", AMBER: "SLOTH", SHAMROCK: "GLUTTONY", AZURE: "GLOOM", INDIGO: "PRIDE", VIOLET: "ENVY",
};
const OLD_DMG: Record<string, DmgType> = { SLASH: "SLASH", PENETRATE: "PIERCE", HIT: "BLUNT", PIERCE: "PIERCE", BLUNT: "BLUNT" };

export interface ImportResult {
  workspace?: Workspace; // a whole workspace
  items: AnyContent[]; // single items to merge
  source: "workspace" | "items" | "legacy" | "unknown";
  message: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** The old single-file app saved { version: 1, identities: [...], enemies: [...] } with game keys. */
function isLegacy(d: Record<string, unknown>): boolean {
  const ids = Array.isArray(d.identities) ? d.identities : [];
  const ens = Array.isArray(d.enemies) ? d.enemies : [];
  const first = [...ids, ...ens][0];
  if (!isObj(first)) return false;
  const skills = Array.isArray(first.skills) ? first.skills : [];
  return typeof first.sinner === "number" || (isObj(skills[0]) && ("dmg" in skills[0] || "coin" in skills[0]));
}

function legacySkill(s: unknown, i: number) {
  const o = isObj(s) ? s : {};
  const coinsN = Math.max(1, Math.min(5, Math.round(Number(o.coins) || 1)));
  return newSkill({
    name: typeof o.name === "string" ? o.name : `Skill ${i + 1}`,
    sin: OLD_SIN[String(o.sin)] ?? "WRATH",
    dmgType: OLD_DMG[String(o.dmg)] ?? "SLASH",
    basePower: Math.round(Number(o.base) || 3),
    coinPower: Math.round(Number(o.coin) || 0),
    coins: Array.from({ length: coinsN }, () => ({ kind: "normal" as const, effects: [] })),
    amount: [3, 2, 1][i] ?? 1,
  });
}

function legacyResist(r: unknown) {
  const o = isObj(r) ? r : {};
  const v = (k: string) => (Number.isFinite(Number(o[k])) ? Number(o[k]) : 1);
  return { SLASH: v("SLASH"), PIERCE: v("PENETRATE"), BLUNT: v("HIT") };
}

function fromLegacy(d: Record<string, unknown>): AnyContent[] {
  const out: AnyContent[] = [];
  for (const x of Array.isArray(d.identities) ? d.identities : []) {
    if (!isObj(x)) continue;
    const skills = (Array.isArray(x.skills) ? x.skills : []).slice(0, 3).map(legacySkill);
    const def = isObj(x.defense) ? x.defense : {};
    const kind = String(def.type ?? "GUARD").toLowerCase();
    out.push(
      newIdentity({
        name: typeof x.name === "string" ? x.name : "Imported Identity",
        sinner: SINNERS[Math.max(0, Math.min(11, Number(x.sinner) || 0))],
        rarity: Math.max(1, Math.min(3, Number(x.rank) || 1)),
        hp: Math.max(1, Math.round(Number(x.hp) || 70)),
        speedMin: Math.round(Number(x.speedMin) || 2),
        speedMax: Math.round(Number(x.speedMax) || 5),
        resist: legacyResist(x.resist),
        skills: skills.length === 3 ? skills : newIdentity().skills,
        defense: [
          newSkill({
            name: typeof def.name === "string" ? def.name : "Guard",
            kind: kind === "evade" ? "evade" : kind === "counter" ? "counter" : "guard",
            sin: OLD_SIN[String(def.sin)] ?? null,
            basePower: Math.round(Number(def.base) || 5),
            coinPower: Math.round(Number(def.coin) || 4),
            coins: Array.from({ length: Math.max(1, Math.min(5, Number(def.coins) || 1)) }, () => ({ kind: "normal" as const, effects: [] })),
            amount: 0,
          }),
        ],
        passives: [],
        notes: "Imported from the original Sinner's Workshop file.",
      }),
    );
  }
  for (const x of Array.isArray(d.enemies) ? d.enemies : []) {
    if (!isObj(x)) continue;
    const skills = (Array.isArray(x.skills) ? x.skills : []).slice(0, 8).map((s, i) => ({ ...legacySkill(s, i), amount: 0 }));
    out.push(
      newEnemy({
        name: typeof x.name === "string" ? x.name : "Imported Enemy",
        level: Math.round(Number(x.level) || 1),
        hp: Math.max(1, Math.round(Number(x.hp) || 100)),
        speedMin: Math.round(Number(x.speedMin) || 2),
        speedMax: Math.round(Number(x.speedMax) || 4),
        resist: legacyResist(x.resist),
        skills: skills.length ? skills : newEnemy().skills,
        notes: "Imported from the original Sinner's Workshop file.",
      }),
    );
  }
  return out;
}

export function parseItem(kind: ContentKind, raw: unknown): AnyContent | null {
  const r = SCHEMA_BY_KIND[kind].safeParse(raw);
  return r.success ? (r.data as AnyContent) : null;
}

export function migrateWorkspace(raw: unknown): Workspace {
  const d = isObj(raw) ? { ...raw } : {};
  // future migrations go here, keyed on d.schemaVersion
  d.schemaVersion = SCHEMA_VERSION;
  return zWorkspace.parse(d);
}

/** Accepts: workspace export, item export ({ kind } or { items }), share code text, or the legacy file. */
export function importAny(text: string): ImportResult {
  let data: unknown;
  const trimmed = text.trim();
  try {
    data = JSON.parse(trimmed);
  } catch {
    const code = decodeShareCode(trimmed);
    if (code === null) return { items: [], source: "unknown", message: "That doesn't look like a Workshop file or share code." };
    data = code;
  }
  if (!isObj(data)) return { items: [], source: "unknown", message: "The file is empty or not a Workshop export." };
  if (isLegacy(data)) {
    const items = fromLegacy(data);
    return { items, source: "legacy", message: `Imported ${items.length} item(s) from the original Sinner's Workshop file.` };
  }
  if (data.format === "sinners-workshop/items" && Array.isArray(data.items)) {
    const items = data.items.map((x) => (isObj(x) && typeof x.kind === "string" && x.kind in SCHEMA_BY_KIND ? parseItem(x.kind as ContentKind, x) : null)).filter(Boolean) as AnyContent[];
    return { items, source: "items", message: `Found ${items.length} item(s).` };
  }
  if (typeof data.kind === "string" && data.kind in SCHEMA_BY_KIND) {
    const item = parseItem(data.kind as ContentKind, data);
    return item ? { items: [item], source: "items", message: "Found 1 item." } : { items: [], source: "unknown", message: "That item could not be read." };
  }
  if ("identities" in data || "enemies" in data || "schemaVersion" in data) {
    const ws = migrateWorkspace(data);
    return { workspace: ws, items: [], source: "workspace", message: `Workspace "${ws.name}" with ${countItems(ws)} item(s).` };
  }
  return { items: [], source: "unknown", message: "Nothing importable was found." };
}

export function countItems(ws: Workspace): number {
  return ws.identities.length + ws.egos.length + ws.enemies.length + ws.encounters.length + ws.events.length + ws.gifts.length + ws.statuses.length + ws.teams.length;
}

/** Items copied into another workspace get fresh ids if the id already exists there. */
export function mergeItems(ws: Workspace, items: AnyContent[]): { workspace: Workspace; added: number; replaced: number } {
  const next: Workspace = structuredClone(ws);
  let added = 0, replaced = 0;
  for (const it of items) {
    const key = COLLECTION[it.kind as ContentKind];
    const arr = next[key] as unknown as AnyContent[];
    const i = arr.findIndex((x) => x.id === it.id);
    if (i >= 0) {
      arr[i] = it;
      replaced++;
    } else {
      arr.push(it);
      added++;
    }
  }
  next.updatedAt = Date.now();
  return { workspace: next, added, replaced };
}

export function duplicateItem<T extends AnyContent>(item: T): T {
  const copy = structuredClone(item) as T;
  copy.id = newId();
  if ("name" in copy) (copy as { name: string }).name = `${(item as { name: string }).name} (copy)`;
  copy.createdAt = copy.updatedAt = Date.now();
  return copy;
}

// ---- share codes ------------------------------------------------------------------
const PREFIX = "SW1:";
export function encodeShareCode(payload: unknown): string {
  return PREFIX + LZString.compressToEncodedURIComponent(JSON.stringify(payload));
}
export function decodeShareCode(text: string): unknown | null {
  const t = text.trim().replace(/^.*[#?&]share=/, "");
  const body = t.startsWith(PREFIX) ? t.slice(PREFIX.length) : t;
  try {
    const json = LZString.decompressFromEncodedURIComponent(body);
    if (!json) return null;
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function itemsPayload(items: AnyContent[]) {
  return { format: "sinners-workshop/items", version: SCHEMA_VERSION, items };
}

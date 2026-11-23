// Turning unknown JSON (exports, share codes, the old one-file Sinner's Workshop)
// into valid content. Never throws: invalid parts are repaired or dropped.
import LZString from "lz-string";
import { SINNERS, type DmgType, type Sin } from "../engine/constants";
import {
  COLLECTION, SCHEMA_BY_KIND, SCHEMA_VERSION, newCoin, newId, zWorkspace, type AnyContent, type ContentKind, type Workspace,
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
/** Own-property test: `"constructor" in {}` is true, so `in` must never be used on untrusted keys. */
const has = (o: object, k: unknown): k is string => typeof k === "string" && Object.prototype.hasOwnProperty.call(o, k);

// Limits for anything a stranger can hand us (file, paste, share code).
export const MAX_IMPORT_CHARS = 12_000_000; // file / pasted text
export const MAX_SHARE_CHARS = 4_000_000; // compressed share code
export const MAX_DECODED_CHARS = 16_000_000; // JSON after decompression
export const MAX_ITEMS_PER_COLLECTION = 3000;

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
    sin: (has(OLD_SIN, o.sin) ? OLD_SIN[o.sin] : "WRATH"),
    dmgType: (has(OLD_DMG, o.dmg) ? OLD_DMG[o.dmg] : "SLASH"),
    basePower: Math.round(Number(o.base) || 3),
    coinPower: Math.round(Number(o.coin) || 0),
    coins: Array.from({ length: coinsN }, () => newCoin()),
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
            sin: (has(OLD_SIN, def.sin) ? OLD_SIN[def.sin] : null),
            basePower: Math.round(Number(def.base) || 5),
            coinPower: Math.round(Number(def.coin) || 4),
            coins: Array.from({ length: Math.max(1, Math.min(5, Number(def.coins) || 1)) }, () => newCoin()),
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

const COLLECTION_KEYS = ["identities", "egos", "enemies", "encounters", "events", "gifts", "statuses", "coinTypes", "teams"] as const;

export function migrateWorkspace(raw: unknown): Workspace {
  const d = isObj(raw) ? { ...raw } : {};
  for (const k of COLLECTION_KEYS) if (Array.isArray(d[k]) && (d[k] as unknown[]).length > MAX_ITEMS_PER_COLLECTION) d[k] = (d[k] as unknown[]).slice(0, MAX_ITEMS_PER_COLLECTION);
  // future migrations go here, keyed on d.schemaVersion
  d.schemaVersion = SCHEMA_VERSION;
  return zWorkspace.parse(d);
}

/** Accepts: workspace export, item export ({ kind } or { items }), share code text, or the legacy file. */
export function importAny(text: string): ImportResult {
  try {
    return importAnyUnsafe(text);
  } catch {
    return { items: [], source: "unknown", message: "That file or code could not be read safely." };
  }
}

/** Imported items must never claim an id in the game's "g:" namespace (it would shadow game data). */
function safeId<T extends { id: string }>(x: T): T {
  return typeof x.id === "string" && x.id.startsWith("g:") ? { ...x, id: newId() } : x;
}

function importAnyUnsafe(text: string): ImportResult {
  let data: unknown;
  if (text.length > MAX_IMPORT_CHARS) return { items: [], source: "unknown", message: "That is too large to be a Workshop file (over 12 MB)." };
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
    const items = fromLegacy(data).map((x) => parseItem(x.kind as ContentKind, x)).filter(Boolean) as AnyContent[];
    return { items, source: "legacy", message: `Imported ${items.length} item(s) from the original Sinner's Workshop file.` };
  }
  if (data.format === "sinners-workshop/items" && Array.isArray(data.items)) {
    const items = data.items.slice(0, MAX_ITEMS_PER_COLLECTION * 3).map((x) => (isObj(x) && has(SCHEMA_BY_KIND, x.kind) ? parseItem(x.kind as ContentKind, x) : null)).filter(Boolean).map((x) => safeId(x as AnyContent));
    return { items, source: "items", message: `Found ${items.length} item(s).` };
  }
  if (has(SCHEMA_BY_KIND, data.kind)) {
    const item = parseItem(data.kind as ContentKind, data);
    return item ? { items: [safeId(item)], source: "items", message: "Found 1 item." } : { items: [], source: "unknown", message: "That item could not be read." };
  }
  if ("identities" in data || "enemies" in data || "schemaVersion" in data) {
    const ws = migrateWorkspace(data);
    for (const k of COLLECTION_KEYS) (ws as unknown as Record<string, { id: string }[]>)[k] = (ws[k] as unknown as { id: string }[]).map(safeId);
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
/**
 * LZ-string decoder with an output cap. LZ data can expand quadratically (a few hundred KB of
 * crafted input would decompress to gigabytes), so lz-string's own decoder must not see untrusted
 * input. This is the same algorithm as LZString.decompressFromEncodedURIComponent, but it gives up
 * (returns null) as soon as the output would exceed `maxLen`.
 */
const URI_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-$";
export function boundedDecompress(input: string, maxLen = MAX_DECODED_CHARS): string | null {
  const src = input.replace(/ /g, "+");
  const length = src.length;
  if (length === 0) return null;
  const reset = 32;
  let val = URI_ALPHABET.indexOf(src.charAt(0));
  let position = reset;
  let index = 1;
  const readBits = (n: number): number => {
    let bits = 0;
    for (let power = 1, max = 2 ** n; power !== max; power <<= 1) {
      const resb = val & position;
      position >>= 1;
      if (position === 0) {
        position = reset;
        val = URI_ALPHABET.indexOf(src.charAt(index++));
      }
      bits |= (resb > 0 ? 1 : 0) * power;
    }
    return bits;
  };
  // `first` caches each entry's first character: charAt(0) on a long concatenated string would flatten it.
  const dict: (string | number)[] = [0, 1, 2];
  const first: string[] = ["", "", ""];
  let enlargeIn = 4, dictSize = 4, numBits = 3;
  let c: string;
  switch (readBits(2)) {
    case 0: c = String.fromCharCode(readBits(8)); break;
    case 1: c = String.fromCharCode(readBits(16)); break;
    default: return "";
  }
  dict[3] = c;
  first[3] = c;
  let w = c;
  let wFirst = c;
  const result: string[] = [c];
  let total = 1;
  for (;;) {
    if (index > length) return null;
    let code = readBits(numBits);
    if (code === 0) {
      const ch = String.fromCharCode(readBits(8));
      first[dictSize] = ch;
      dict[dictSize++] = ch;
      code = dictSize - 1;
      enlargeIn--;
    } else if (code === 1) {
      const ch = String.fromCharCode(readBits(16));
      first[dictSize] = ch;
      dict[dictSize++] = ch;
      code = dictSize - 1;
      enlargeIn--;
    } else if (code === 2) {
      return result.join("");
    }
    if (enlargeIn === 0) {
      enlargeIn = 2 ** numBits;
      numBits++;
    }
    let entry: string;
    let entryFirst: string;
    const known = dict[code];
    if (typeof known === "string") {
      entry = known;
      entryFirst = first[code];
    } else if (code === dictSize) {
      entry = w + wFirst;
      entryFirst = wFirst;
    } else return null;
    total += entry.length;
    if (total > maxLen) return null;
    result.push(entry);
    first[dictSize] = wFirst;
    dict[dictSize++] = w + entryFirst;
    enlargeIn--;
    w = entry;
    wFirst = entryFirst;
    if (enlargeIn === 0) {
      enlargeIn = 2 ** numBits;
      numBits++;
    }
  }
}

export function decodeShareCode(text: string): unknown | null {
  const t = text.trim().replace(/^.*[#?&]share=/, "");
  const body = t.startsWith(PREFIX) ? t.slice(PREFIX.length) : t;
  if (body.length > MAX_SHARE_CHARS) return null;
  try {
    const json = boundedDecompress(body);
    if (!json) return null;
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function itemsPayload(items: AnyContent[]) {
  return { format: "sinners-workshop/items", version: SCHEMA_VERSION, items };
}

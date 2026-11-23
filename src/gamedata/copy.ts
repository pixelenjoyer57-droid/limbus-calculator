import { newId, type AnyContent, type ContentKind, type CustomStatus, type Workspace } from "../data/schema";
import { COLLECTION } from "../data/schema";
import { useWorkspace } from "../store/workspace";
import { gameKindOfId, useGameData } from "./store";
import type { GameItem } from "./types";

const STATUS_KEY_RE = /"(G_[^"\\]*)"/g;
const GAME_ID_RE = /"(g:(?:id|ego|en|gift):[^"\\]+)"/g;

function scan(value: unknown, re: RegExp): string[] {
  const text = typeof value === "string" ? value : JSON.stringify(value) ?? "";
  const out = new Set<string>();
  for (const m of text.matchAll(re)) out.add(m[1]);
  return [...out];
}

/** Every game status key ("G_…") mentioned anywhere inside `value` (an item, a workspace…). */
export const referencedStatusKeys = (value: unknown): string[] => scan(value, STATUS_KEY_RE);
/** Every game item id ("g:id:…", "g:ego:…", "g:en:…", "g:gift:…") mentioned anywhere inside `value`. */
export const referencedGameIds = (value: unknown): string[] => scan(value, GAME_ID_RE);

/** The wiki page title for an item (gifts and statuses come from data modules, so their name is the page). */
export function wikiPageTitle(item: { name: string; source: string }): string {
  return !item.source || item.source.startsWith("Module:") ? item.name : item.source;
}

/** Link to the item's page on the Limbus Company wiki. */
export function wikiUrl(item: { name: string; source: string }): string {
  const title = wikiPageTitle(item).replace(/ /g, "_");
  return `https://limbuscompany.wiki.gg/wiki/${title.split("/").map(encodeURIComponent).join("/")}`;
}

/** Deep-clones `item`, giving every "g:…" id inside it (skills, coins, effects…) a fresh id, and fixes enemy rotations. */
function cloneWithFreshIds<T>(item: T): T {
  const map = new Map<string, string>();
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) {
        if (k === "id" && typeof x === "string" && x.startsWith("g:")) {
          const n = newId();
          map.set(x, n);
          out[k] = n;
        } else out[k] = walk(x);
      }
      return out;
    }
    return v;
  };
  const copy = walk(item) as Record<string, unknown>;
  if (Array.isArray(copy.rotation)) copy.rotation = (copy.rotation as string[][]).map((t) => t.map((id) => map.get(id) ?? id));
  return copy as T;
}

/** All game statuses reachable from `roots` (following references between statuses), skipping keys in `skip`. */
function collectStatuses(roots: unknown[], skip: Set<string>): CustomStatus[] {
  const byKey = useGameData.getState().statusByKey;
  const found = new Map<string, CustomStatus>();
  const queue = roots.flatMap(referencedStatusKeys);
  while (queue.length) {
    const key = queue.pop()!;
    if (found.has(key) || skip.has(key)) continue;
    const st = byKey.get(key);
    if (!st) continue;
    found.set(key, st);
    queue.push(...referencedStatusKeys(st));
  }
  return [...found.values()];
}

/**
 * Makes an editable copy of a game item. Returns the items to insert with `upsert`:
 * the copy first (fresh id, same name/tags, `source` = wiki page), then copies of every
 * game status (key "G_…") it references that the workspace doesn't have yet (same key),
 * so the copy works on its own and exports cleanly. Needs the game statuses loaded
 * (call `ensureGameData(["status"])` first). `ws` defaults to the active workspace.
 */
export function copyToWorkshop(item: GameItem, ws: Workspace = useWorkspace.getState().ws): AnyContent[] {
  const now = Date.now();
  const have = new Set(ws.statuses.map((s) => s.key));
  const main = cloneWithFreshIds(item) as GameItem;
  main.createdAt = main.updatedAt = now;
  main.source = wikiPageTitle(item);
  if (main.kind === "status") {
    let key = main.key;
    for (let n = 2; have.has(key); n++) key = `${main.key}_${n}`;
    main.key = key;
  }
  const own = item.kind === "status" ? new Set([item.key]) : new Set<string>();
  const extra = collectStatuses([item], new Set([...have, ...own])).map((s) => {
    const c = cloneWithFreshIds(s);
    c.createdAt = c.updatedAt = now;
    c.source = wikiPageTitle(s);
    return c;
  });
  return [main as AnyContent, ...extra];
}

/**
 * For the engine: returns a NEW workspace made of the user's workspace plus the game items
 * whose ids are in `refs` (identities, E.G.O, enemies, gifts — "g:…" ids), plus any game id
 * the workspace itself mentions (e.g. a team or encounter using a game enemy), plus every
 * game status ("G_…") referenced by those items or by the user's own content.
 * Items already in the workspace (same id / same status key) win. Game data must be loaded
 * first (`ensureGameData()`); ids that aren't loaded are skipped. The result is only for
 * simulation: never save it into the store.
 */
export function withGameData(ws: Workspace, refs: Iterable<string> = []): Workspace {
  const st = useGameData.getState();
  const ids = new Set<string>([...refs, ...referencedGameIds(ws)]);
  const next: Workspace = { ...ws };
  const add = (kind: ContentKind, item: AnyContent) => {
    const key = COLLECTION[kind];
    const arr = (next[key] as unknown as AnyContent[]) === (ws[key] as unknown as AnyContent[]) ? [...(ws[key] as unknown as AnyContent[])] : (next[key] as unknown as AnyContent[]);
    (next as unknown as Record<string, unknown>)[key] = arr;
    if (!arr.some((x) => x.id === item.id)) arr.push(item);
  };
  const picked: GameItem[] = [];
  for (const id of ids) {
    const kind = gameKindOfId(id);
    if (!kind || kind === "status") continue;
    const item = st.kinds[kind].byId.get(id);
    if (item) {
      add(kind, item as AnyContent);
      picked.push(item);
    }
  }
  const have = new Set(ws.statuses.map((s) => s.key));
  const statuses = collectStatuses([...picked, ws], have);
  for (const s of statuses) add("status", s);
  return next;
}

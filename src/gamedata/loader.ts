// Fetches and validates the game data snapshot (public/gamedata/*.json).
// Nothing from that folder is bundled: it is always fetched at run time.
import { zCustomStatus, zEgo, zEnemy, zGift, zIdentity } from "../data/schema";
import { GAME_FILE, type GameIndex, type GameItem, type GameKind } from "./types";

const SCHEMAS = { identity: zIdentity, ego: zEgo, enemy: zEnemy, gift: zGift, status: zCustomStatus } as const;

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function urlFor(file: string): string {
  const base = typeof document !== "undefined" ? document.baseURI : "http://localhost/";
  return new URL(`gamedata/${file}.json`, base).toString();
}

async function fetchJSON(file: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(urlFor(file));
  } catch {
    throw new Error("Couldn't reach the game data. Check your connection and try again.");
  }
  if (!res.ok) throw new Error(`The game data file wasn't found (error ${res.status}).`);
  try {
    return await res.json();
  } catch {
    throw new Error("The game data file couldn't be read.");
  }
}

export async function loadIndex(): Promise<GameIndex> {
  const raw = (await fetchJSON("index")) as Partial<GameIndex>;
  return {
    format: raw.format ?? 1,
    generatedAt: raw.generatedAt ?? "",
    wikiUpdatedAt: raw.wikiUpdatedAt ?? "",
    source: raw.source ?? "https://limbuscompany.wiki.gg",
    license: raw.license ?? "CC BY-SA 4.0",
    attribution: raw.attribution ?? "Game data from the Limbus Company Wiki (limbuscompany.wiki.gg), licensed CC BY-SA 4.0. Limbus Company belongs to Project Moon.",
    counts: raw.counts ?? {},
  };
}

/** Loads one kind and parses every item with its zod schema, in small chunks so the UI stays responsive. */
export async function loadKind(kind: GameKind, chunk = 40): Promise<GameItem[]> {
  const raw = await fetchJSON(GAME_FILE[kind].file);
  if (!Array.isArray(raw)) throw new Error("The game data file has an unexpected shape.");
  const schema = SCHEMAS[kind];
  const out: GameItem[] = [];
  for (let i = 0; i < raw.length; i += chunk) {
    for (const r of raw.slice(i, i + chunk)) {
      const p = schema.safeParse(r);
      if (p.success) out.push(p.data as GameItem);
    }
    await tick();
  }
  return out;
}

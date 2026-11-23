// In-memory game data: loaded once per kind, on demand.
import { useEffect } from "react";
import { create } from "zustand";
import type { CustomStatus } from "../data/schema";
import { loadIndex, loadKind } from "./loader";
import { GAME_KINDS, type GameIndex, type GameItem, type GameItemMap, type GameKind, type LoadStatus } from "./types";

interface KindState<K extends GameKind = GameKind> {
  status: LoadStatus;
  items: GameItemMap[K][];
  byId: Map<string, GameItemMap[K]>;
  error: string;
}

const emptyKind = (): KindState => ({ status: "idle", items: [], byId: new Map(), error: "" });

interface GameDataState {
  kinds: { [K in GameKind]: KindState<K> };
  /** Game statuses by their key (G_…). */
  statusByKey: Map<string, CustomStatus>;
  index: GameIndex | null;
  indexStatus: LoadStatus;
  /** Starts loading a kind (once). Safe to call from render effects. Retries after an error. */
  ensure: (kind: GameKind) => Promise<void>;
  ensureIndex: () => Promise<void>;
  retry: (kind: GameKind) => Promise<void>;
}

const inflight = new Map<string, Promise<void>>();

export const useGameData = create<GameDataState>((set, get) => ({
  kinds: { identity: emptyKind(), ego: emptyKind(), enemy: emptyKind(), gift: emptyKind(), status: emptyKind() } as GameDataState["kinds"],
  statusByKey: new Map(),
  index: null,
  indexStatus: "idle",

  ensureIndex: async () => {
    if (get().indexStatus === "ready" || get().indexStatus === "loading") return inflight.get("index");
    set({ indexStatus: "loading" });
    const p = loadIndex().then(
      (index) => set({ index, indexStatus: "ready" }),
      () => set({ indexStatus: "error" }),
    );
    inflight.set("index", p);
    return p;
  },

  ensure: async (kind) => {
    const cur = get().kinds[kind];
    if (cur.status === "ready" || cur.status === "loading") return inflight.get(kind);
    const setKind = (patch: Partial<KindState>) => set((s) => ({ kinds: { ...s.kinds, [kind]: { ...s.kinds[kind], ...patch } } }));
    setKind({ status: "loading", error: "" });
    void get().ensureIndex();
    const p = loadKind(kind).then(
      (items) => {
        const byId = new Map<string, GameItem>(items.map((x) => [x.id, x]));
        setKind({ status: "ready", items, byId });
        if (kind === "status") set({ statusByKey: new Map((items as CustomStatus[]).map((x) => [x.key, x])) });
      },
      (e: unknown) => setKind({ status: "error", error: e instanceof Error ? e.message : "Couldn't load the game data." }),
    );
    inflight.set(kind, p);
    return p;
  },

  retry: (kind) => {
    inflight.delete(kind);
    set((s) => ({ kinds: { ...s.kinds, [kind]: emptyKind() } }));
    if (get().indexStatus === "error") set({ indexStatus: "idle" });
    return get().ensure(kind);
  },
}));

/** Game ids start with "g:" (user content never does). */
export const isGameId = (id: string | null | undefined): boolean => typeof id === "string" && id.startsWith("g:");

/** Looks an item up in memory (returns undefined while that kind is not loaded yet). */
export function findGameItem<K extends GameKind>(kind: K, id: string): GameItemMap[K] | undefined {
  return useGameData.getState().kinds[kind].byId.get(id) as GameItemMap[K] | undefined;
}

/** Looks a game status up by its G_ key. */
export function findGameStatus(key: string): CustomStatus | undefined {
  return useGameData.getState().statusByKey.get(key);
}

/** The game kind a game id belongs to ("g:en:…" is an enemy), or null. */
export function gameKindOfId(id: string): GameKind | null {
  if (id.startsWith("g:id:")) return "identity";
  if (id.startsWith("g:ego:")) return "ego";
  if (id.startsWith("g:en:")) return "enemy";
  if (id.startsWith("g:gift:")) return "gift";
  if (id.startsWith("g:status:")) return "status";
  return null;
}

/** React hook: starts loading `kind` and returns its status, items and lookup map. */
export function useGameItems<K extends GameKind>(kind: K, enabled = true): { status: LoadStatus; items: GameItemMap[K][]; byId: Map<string, GameItemMap[K]>; error: string; retry: () => void } {
  const state = useGameData((s) => s.kinds[kind]) as KindState<K>;
  const ensure = useGameData((s) => s.ensure);
  const retry = useGameData((s) => s.retry);
  useEffect(() => {
    if (enabled) void ensure(kind);
  }, [enabled, kind, ensure]);
  return { ...state, retry: () => void retry(kind) };
}

/** Loads every kind in the list (resolves when done; failures are left in each kind's status). */
export async function ensureGameData(kinds: GameKind[] = GAME_KINDS): Promise<void> {
  await Promise.all(kinds.map((k) => useGameData.getState().ensure(k)));
}

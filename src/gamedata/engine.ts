// Helpers that make game items visible to screens and to the engine.
import { useEffect, useMemo } from "react";
import type { Workspace } from "../data/schema";
import { referencedGameIds, referencedStatusKeys, withGameData } from "./copy";
import { ensureGameData, gameKindOfId, useGameData } from "./store";
import type { GameKind } from "./types";

/**
 * For the engine: returns the workspace plus every game item it (or `refs`) needs.
 * Only the kinds actually referenced are downloaded, so fights with your own
 * content never fetch the (large) game data files.
 */
export async function engineWorkspace(ws: Workspace, refs: Iterable<string> = []): Promise<Workspace> {
  const ids = [...new Set([...refs].filter((r) => r.startsWith("g:")).concat(referencedGameIds(ws)))];
  const kinds = new Set<GameKind>();
  for (const id of ids) {
    const k = gameKindOfId(id);
    if (k) kinds.add(k);
  }
  const have = new Set(ws.statuses.map((s) => s.key));
  if (kinds.size || referencedStatusKeys(ws).some((k) => !have.has(k))) kinds.add("status");
  if (!kinds.size) return ws;
  await ensureGameData([...kinds]);
  return withGameData(ws, ids);
}

/**
 * For screens: the workspace merged with the game items in `refs` (and those the workspace
 * mentions). Starts loading the needed game data and re-renders when it arrives.
 */
export function useGameWorkspace(ws: Workspace, refs: Iterable<string> = []): Workspace {
  const key = [...new Set(refs)].filter((r) => r.startsWith("g:")).sort().join("\n");
  const wsIds = useMemo(() => referencedGameIds(ws), [ws]);
  const kinds = useMemo(() => {
    const set = new Set<GameKind>();
    for (const id of [...wsIds, ...(key ? key.split("\n") : [])]) {
      const k = gameKindOfId(id);
      if (k) set.add(k);
    }
    if (set.size) set.add("status");
    return [...set];
  }, [wsIds, key]);
  const kindsKey = kinds.join(",");
  useEffect(() => {
    if (kinds.length) void ensureGameData(kinds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kindsKey]);
  const loaded = useGameData((s) => kinds.map((k) => s.kinds[k].status).join(","));
  return useMemo(
    () => (kinds.length ? withGameData(ws, key ? key.split("\n") : []) : ws),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ws, key, loaded, kindsKey],
  );
}

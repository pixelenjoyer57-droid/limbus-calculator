import type { CustomStatus, Ego, Enemy, Gift, Identity } from "../data/schema";

/** Content kinds that exist as read-only game data. */
export type GameKind = "identity" | "ego" | "enemy" | "gift" | "status";
export const GAME_KINDS: GameKind[] = ["identity", "ego", "enemy", "gift", "status"];

export interface GameItemMap {
  identity: Identity;
  ego: Ego;
  enemy: Enemy;
  gift: Gift;
  status: CustomStatus;
}
export type GameItem = GameItemMap[GameKind];

/** File name (without .json) and index.json count key for each kind. */
export const GAME_FILE: Record<GameKind, { file: string; count: "identities" | "egos" | "enemies" | "gifts" | "statuses" }> = {
  identity: { file: "identities", count: "identities" },
  ego: { file: "egos", count: "egos" },
  enemy: { file: "enemies", count: "enemies" },
  gift: { file: "gifts", count: "gifts" },
  status: { file: "statuses", count: "statuses" },
};

export interface GameIndex {
  format: number;
  generatedAt: string;
  wikiUpdatedAt: string;
  source: string;
  license: string;
  attribution: string;
  counts: Record<string, number>;
}

export type LoadStatus = "idle" | "loading" | "ready" | "error";

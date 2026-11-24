// Search text and filters of the gift grid, kept while the app stays open (not saved to disk).
import { create } from "zustand";

export interface GiftGridState {
  tab: "own" | "game";
  query: string;
  tier: string;
  keyword: string;
  legacy: boolean;
  selectedOnly: boolean;
  set: (patch: Partial<Omit<GiftGridState, "set" | "clear">>) => void;
  clear: () => void;
}

export const useGiftGrid = create<GiftGridState>((set) => ({
  tab: "game",
  query: "",
  tier: "",
  keyword: "",
  legacy: false,
  selectedOnly: false,
  set: (patch) => set(patch),
  clear: () => set({ query: "", tier: "", keyword: "", legacy: false, selectedOnly: false }),
}));

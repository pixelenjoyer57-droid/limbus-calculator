// Tier, keyword and legacy filters for E.G.O Gifts. Shared by the game library and the team gift grid.
import type { Gift } from "../../data/schema";

export const isNoTier = (g: Gift) => g.tags.includes("No tier (story/other)");
export const isLegacy = (g: Gift) => g.tags.includes("Legacy");
export const capWord = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

export interface GiftFilter {
  /** "" = all tiers, "none" = gifts without a tier, otherwise a tier such as "III". */
  tier: string;
  /** "" = all keywords. */
  keyword: string;
  /** Legacy gifts are hidden unless this is on. */
  legacy: boolean;
}

export const NO_GIFT_FILTER: GiftFilter = { tier: "", keyword: "", legacy: false };

/** True when the gift passes the tier, keyword and legacy filters. */
export function giftPasses(g: Gift, f: GiftFilter): boolean {
  if (!f.legacy && isLegacy(g)) return false;
  if (f.tier && (f.tier === "none" ? !isNoTier(g) : isNoTier(g) || g.tier !== f.tier)) return false;
  if (f.keyword && g.keyword !== f.keyword) return false;
  return true;
}

/** "Tier III", "EX" or "No tier". */
export const tierText = (g: Gift) => (isNoTier(g) ? "No tier" : g.tier === "EX" ? "EX" : `Tier ${g.tier}`);
/** "Burn", or "no keyword". */
export const keywordText = (g: Gift) => (g.keyword === "NONE" ? "no keyword" : capWord(g.keyword));

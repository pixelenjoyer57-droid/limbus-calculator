// Turning gifts on and off in a team's gift list. Pure functions, so the rules are easy to test.
export const MAX_TEAM_GIFTS = 80;

export interface TeamGift {
  giftId: string;
  level: number;
}

/** How many entries each gift has (a gift can be listed more than once). */
export function countById(gifts: readonly TeamGift[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const g of gifts) m.set(g.giftId, (m.get(g.giftId) ?? 0) + 1);
  return m;
}

export type ToggleResult =
  | { kind: "added"; gifts: TeamGift[]; index: number }
  | { kind: "removed"; gifts: TeamGift[]; index: number; entry: TeamGift }
  | { kind: "limit"; gifts: TeamGift[] };

/**
 * Off -> adds one entry at Base level (or refuses at the limit).
 * On -> removes one entry (the last one, so earlier entries and their levels stay).
 * Levels of other entries are never touched.
 */
export function toggleGift(gifts: readonly TeamGift[], giftId: string): ToggleResult {
  let last = -1;
  for (let i = gifts.length - 1; i >= 0; i--) {
    if (gifts[i].giftId === giftId) {
      last = i;
      break;
    }
  }
  if (last >= 0) {
    const next = gifts.slice();
    const [entry] = next.splice(last, 1);
    return { kind: "removed", gifts: next, index: last, entry };
  }
  if (gifts.length >= MAX_TEAM_GIFTS) return { kind: "limit", gifts: gifts.slice() };
  return { kind: "added", gifts: [...gifts, { giftId, level: 0 }], index: gifts.length };
}

/** Puts a removed entry back where it was. Null if there is no room any more. */
export function restoreGift(gifts: readonly TeamGift[], entry: TeamGift, index: number): TeamGift[] | null {
  if (gifts.length >= MAX_TEAM_GIFTS) return null;
  const next = gifts.slice();
  next.splice(Math.min(index, next.length), 0, entry);
  return next;
}

/** Accessible name of a gift button: gift, tier, keyword, source. No on/off state (that is the pressed state). */
export function giftButtonName(g: { name: string }, tier: string, keyword: string, own: boolean): string {
  return `${g.name || "Untitled"}, ${tier}, ${keyword}, ${own ? "your content" : "from the game"}`;
}

export const limitMessage = `The team already has ${MAX_TEAM_GIFTS} gifts, which is the most it can hold. Turn one off to make room.`;
export const countText = (n: number) => `${n} of ${MAX_TEAM_GIFTS} selected`;
export const giftSummary = (n: number) => `${n} gift${n === 1 ? "" : "s"}`;

// Search, sort and paging rules shared by the content picker and the team gift grid.
export const PAGE = 60;

export interface Searchable {
  id: string;
  name: string;
}

/** Name without punctuation, lower case: the sort order everywhere items are listed. */
export const sortKey = (n: string) => n.replace(/[^\p{L}\p{N} ]/gu, "").trim().toLowerCase();

const hay = new WeakMap<object, string>();
/** One lower-case string per item holding every searchable field (cached). */
export function haystack(x: Searchable): string {
  let h = hay.get(x);
  if (h === undefined) {
    const a = x as unknown as { name: string; source?: string; tags?: string[]; sinner?: string; grade?: string; keyword?: string };
    h = [a.name, a.source, a.sinner, a.grade, a.keyword, ...(a.tags ?? [])].filter(Boolean).join(" | ").toLowerCase();
    hay.set(x, h);
  }
  return h;
}

export const searchWords = (q: string) => q.trim().toLowerCase().split(/\s+/).filter(Boolean);

/** Items matching every word of the query (and the optional extra test), sorted by name. */
export function searchItems<T extends Searchable>(source: readonly T[], query: string, extra?: (x: T) => boolean): T[] {
  const words = searchWords(query);
  return source
    .filter((x) => (!extra || extra(x)) && words.every((w) => haystack(x).includes(w)))
    .sort((a, b) => sortKey(a.name).localeCompare(sortKey(b.name)));
}

/** How many items are visible and how many are left after the user asks for more. */
export function pageInfo(total: number, shown: number) {
  const visible = Math.min(shown, total);
  return { visible, left: Math.max(0, total - shown), nextShown: shown + PAGE };
}

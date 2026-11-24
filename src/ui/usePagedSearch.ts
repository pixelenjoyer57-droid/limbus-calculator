import { useCallback, useDeferredValue, useMemo, useState } from "react";
import { PAGE, searchItems, type Searchable } from "../lib/search";

/**
 * Search text (applied once typing settles), sorted results and 60-per-page paging.
 * Used by the content picker and the team gift grid.
 */
export function usePagedSearch<T extends Searchable>(source: readonly T[], extra?: (x: T) => boolean, opts: { initialQuery?: string; onQueryChange?: (q: string) => void } = {}) {
  const [query, setQueryState] = useState(opts.initialQuery ?? "");
  const [shown, setShown] = useState(PAGE);
  const q = useDeferredValue(query);
  const results = useMemo(() => searchItems(source, q, extra), [source, q, extra]);
  const resetPaging = useCallback(() => setShown(PAGE), []);
  const setQuery = (v: string) => {
    setQueryState(v);
    setShown(PAGE);
    opts.onQueryChange?.(v);
  };
  const showMore = () => setShown((n) => n + PAGE);
  return { query, setQuery, q, results, shown, visible: results.slice(0, shown), resetPaging, showMore };
}

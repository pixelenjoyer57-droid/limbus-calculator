// Reusable picker for content that can come from the user's workshop or from the game data.
import { useEffect, useMemo, useRef, useState } from "react";
import { usePagedSearch } from "./usePagedSearch";
import { COLLECTION, type AnyContent } from "../data/schema";
import { useWorkspace } from "../store/workspace";
import { useGameData, useGameItems, isGameId, gameKindOfId, type GameItem } from "../gamedata";
import { gameSubtitle } from "../features/library/GameList";
import { Button } from "./controls";
import { Icon } from "./icons";
import { Dialog, EmptyState, Notice, Tabs } from "./layout";
import "./contentpicker.css";

export type PickKind = "identity" | "ego" | "enemy" | "gift";
type PickItem = AnyContent & { name: string; source?: string; tags?: string[] };

const KIND_WORD: Record<PickKind, string> = { identity: "Identity", ego: "E.G.O", enemy: "enemy", gift: "E.G.O Gift" };

/**
 * Finds an item by id in the user's workspace or in the game data (starts loading the game
 * data for "g:" ids). Returns undefined while loading or when it doesn't exist.
 */
export function useResolvedItem<T extends PickKind>(kind: T, id: string | null | undefined): { item: (PickItem & { kind: T }) | undefined; loading: boolean; game: boolean } {
  const own = useWorkspace((s) => (id ? (s.ws[COLLECTION[kind]] as unknown as PickItem[]).find((x) => x.id === id) : undefined));
  const game = isGameId(id);
  const g = useGameItems(kind, game && !own);
  const item = own ?? (game ? (g.byId.get(id!) as unknown as PickItem | undefined) : undefined);
  return { item: item as (PickItem & { kind: T }) | undefined, loading: game && !own && (g.status === "loading" || g.status === "idle"), game };
}

/** Name of an item by id (works for game ids once loaded); "" when unknown. */
export function useItemName(kind: PickKind, id: string | null | undefined): string {
  return useResolvedItem(kind, id).item?.name ?? "";
}

export function ContentPicker({
  kind, value, onChange, label, filter, allowNone, noneLabel = "None", className = "", compact,
}: {
  kind: PickKind;
  value: string | null;
  onChange: (id: string | null) => void;
  label: string;
  filter?: (item: any) => boolean; // eslint-disable-line @typescript-eslint/no-explicit-any
  allowNone?: boolean;
  noneLabel?: string;
  className?: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { item, loading, game } = useResolvedItem(kind, value);
  const text = !value ? (allowNone ? noneLabel : "Pick…") : item ? item.name || "Untitled" : loading ? "Loading…" : "(missing)";
  return (
    <div className={`field ${className}`}>
      {!compact && <span className="label">{label}</span>}
      <button type="button" className="input picker-btn" aria-haspopup="dialog" aria-label={`${label}: ${text}. Change`} onClick={() => setOpen(true)}>
        <span className="picker-name">{text}</span>
        {game && value && <span className="badge picker-tag">from the game</span>}
        <Icon name="chevron" size={16} className="picker-chev" />
      </button>
      {open && <PickerDialog kind={kind} value={value} label={label} filter={filter} allowNone={allowNone} noneLabel={noneLabel} onClose={() => setOpen(false)} onPick={(id) => { onChange(id); setOpen(false); }} />}
    </div>
  );
}

function PickerDialog({ kind, value, label, filter, allowNone, noneLabel, onClose, onPick }: {
  kind: PickKind; value: string | null; label: string; filter?: (item: any) => boolean; allowNone?: boolean; noneLabel: string; // eslint-disable-line @typescript-eslint/no-explicit-any
  onClose: () => void; onPick: (id: string | null) => void;
}) {
  const own = useWorkspace((s) => s.ws[COLLECTION[kind]] as unknown as PickItem[]);
  const [tab, setTab] = useState<"own" | "game">(isGameId(value) ? "game" : "own");
  const game = useGameItems(kind, tab === "game");
  const total = useGameData((s) => s.index?.counts[{ identity: "identities", ego: "egos", enemy: "enemies", gift: "gifts" }[kind]]);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const t = setTimeout(() => searchRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, []);

  const ownFiltered = useMemo(() => (filter ? own.filter(filter) : own), [own, filter]);
  const gameFiltered = useMemo(() => (filter ? (game.items as unknown as PickItem[]).filter(filter) : (game.items as unknown as PickItem[])), [game.items, filter]);
  const source = tab === "own" ? ownFiltered : gameFiltered;
  const { query, setQuery, q, results, shown, visible, resetPaging, showMore } = usePagedSearch(source);

  const loadingGame = tab === "game" && game.status !== "ready" && game.status !== "error";
  return (
    <Dialog open onClose={onClose} title={`Pick: ${label}`}>
      <div className="stack">
        <Tabs
          label="Where from"
          value={tab}
          onChange={(v) => { setTab(v); resetPaging(); }}
          tabs={[
            { value: "own", label: `Your content (${ownFiltered.length})` },
            { value: "game", label: `From the game (${game.status === "ready" ? gameFiltered.length : total ?? "…"})` },
          ]}
        />
        <div className="field">
          <label className="sr-only" htmlFor="picker-search">Search {KIND_WORD[kind]} by name, tag, Sinner or source</label>
          <input id="picker-search" ref={searchRef} className="input" type="search" autoFocus placeholder="Search name, tag, Sinner, source…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        {allowNone && (
          <button type="button" className="list-item picker-row" aria-current={!value ? "true" : undefined} onClick={() => onPick(null)}>
            <span className="li-main"><span className="li-name">{noneLabel}</span></span>
          </button>
        )}
        {tab === "game" && game.status === "error" ? (
          <Notice kind="error">
            <p style={{ margin: 0 }}>{game.error}</p>
            <div style={{ marginTop: 8 }}><Button small onClick={game.retry}>Retry</Button></div>
          </Notice>
        ) : loadingGame ? (
          <p className="muted" role="status">Loading game data…</p>
        ) : results.length === 0 ? (
          <EmptyState title="Nothing here">
            {tab === "own" && !q ? `You haven't made any ${KIND_WORD[kind]} that fits yet. Try the "From the game" tab.` : "Try fewer words."}
          </EmptyState>
        ) : (
          <>
            <p className="small muted" role="status">Showing {Math.min(shown, results.length)} of {results.length}</p>
            <ul className="picker-list">
              {visible.map((x) => (
                <li key={x.id}>
                  <button type="button" className="list-item picker-row" aria-current={x.id === value ? "true" : undefined} onClick={() => onPick(x.id)}>
                    <span className="li-main">
                      <span className="li-name">{x.name || "Untitled"}</span>
                      <span className="li-sub">{gameSubtitle(x as unknown as GameItem)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {results.length > shown && <Button block onClick={showMore}>Show more ({results.length - shown} left)</Button>}
          </>
        )}
      </div>
    </Dialog>
  );
}

export { gameKindOfId };
